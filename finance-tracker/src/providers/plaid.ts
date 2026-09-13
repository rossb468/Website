import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  type AccountBase,
  type Transaction as PlaidTransaction,
  type TransactionsSyncResponse,
} from 'plaid';
import { createHash } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, decodeProtectedHeader, type JSONWebKeySet, type JWK } from 'jose';
import type { CanonicalAccount, CanonicalTransaction, SyncPage } from '../core/types.js';
import { toMinorUnits } from '../core/money.js';
import type { Config } from '../config.js';
import { logger } from '../logger.js';
import {
  ProviderConfigError,
  ProviderCursorInvalid,
  ProviderRateLimited,
  ProviderReauthRequired,
  type FinancialDataProvider,
} from './types.js';

/** Shape of the error body Plaid returns inside an Axios failure. */
interface PlaidErrorBody {
  error_type?: string;
  error_code?: string;
  error_message?: string;
  display_message?: string;
}

function plaidError(err: unknown): PlaidErrorBody | undefined {
  const response = (err as { response?: { data?: PlaidErrorBody } })?.response;
  return response?.data;
}

/**
 * Translate Plaid's amount convention to ours.
 *
 * Plaid: positive when money leaves the account (a debit card purchase is
 * `+4.50`). That reads backwards to most people and inverts the sign of every
 * delta, so we flip it: negative means money left the account.
 */
function normalizeAmount(tx: PlaidTransaction): number {
  const currency = tx.iso_currency_code ?? tx.unofficial_currency_code ?? 'USD';
  return -toMinorUnits(tx.amount, currency);
}

export function toCanonicalTransaction(tx: PlaidTransaction): CanonicalTransaction {
  const currency = tx.iso_currency_code ?? tx.unofficial_currency_code ?? 'USD';
  return {
    transactionId: tx.transaction_id,
    accountId: tx.account_id,
    amount: normalizeAmount(tx),
    currency,
    date: tx.date,
    authorizedDate: tx.authorized_date ?? null,
    name: tx.name,
    merchantName: tx.merchant_name ?? null,
    pending: tx.pending,
    pendingTransactionId: tx.pending_transaction_id ?? null,
    category: tx.personal_finance_category?.primary ?? tx.category?.[0] ?? null,
    categoryDetailed: tx.personal_finance_category?.detailed ?? null,
    paymentChannel: (tx as { payment_channel?: string }).payment_channel ?? null,
    logoUrl: tx.logo_url ?? null,
    website: tx.website ?? null,
    raw: tx,
  };
}

export function toCanonicalAccount(account: AccountBase, itemId: string): CanonicalAccount {
  const currency = account.balances.iso_currency_code ?? account.balances.unofficial_currency_code ?? 'USD';
  const conv = (v: number | null | undefined) => (v === null || v === undefined ? null : toMinorUnits(v, currency));
  return {
    accountId: account.account_id,
    itemId,
    name: account.name,
    officialName: account.official_name ?? null,
    mask: account.mask ?? null,
    type: String(account.type),
    subtype: account.subtype ? String(account.subtype) : null,
    currentBalance: conv(account.balances.current),
    availableBalance: conv(account.balances.available),
    creditLimit: conv(account.balances.limit),
    currency,
  };
}

export class PlaidProvider implements FinancialDataProvider {
  readonly name = 'plaid';
  readonly client: PlaidApi;
  /** Plaid rotates webhook signing keys; cache them by key id. */
  private readonly jwkCache = new Map<string, JWK>();

  constructor(private readonly config: Config) {
    if (!config.plaidClientId || !config.plaidSecret) {
      throw new Error('PlaidProvider requires PLAID_CLIENT_ID and PLAID_SECRET');
    }
    this.client = new PlaidApi(
      new Configuration({
        basePath: PlaidEnvironments[config.plaidEnv]!,
        baseOptions: {
          headers: {
            'PLAID-CLIENT-ID': config.plaidClientId,
            'PLAID-SECRET': config.plaidSecret,
            'Plaid-Version': '2020-09-14',
          },
        },
      }),
    );
  }

  async syncPage(accessToken: string, cursor: string | undefined): Promise<SyncPage> {
    try {
      const res = await this.client.transactionsSync({
        access_token: accessToken,
        // Plaid rejects an explicit null; omit the field entirely for a
        // first-ever sync.
        ...(cursor ? { cursor } : {}),
        count: 500,
        options: {
          include_personal_finance_category: true,
          include_original_description: true,
        },
      });
      return this.toSyncPage(res.data, accessToken);
    } catch (err) {
      throw this.translateError(err);
    }
  }

  private toSyncPage(data: TransactionsSyncResponse, accessToken: string): SyncPage {
    // `accounts` carries live balances on every sync response, so tracking
    // balance movement costs no extra API call.
    const itemId = this.itemIdHint(data, accessToken);
    return {
      added: data.added.map(toCanonicalTransaction),
      modified: data.modified.map(toCanonicalTransaction),
      removed: data.removed.map((r) => r.transaction_id).filter((id): id is string => Boolean(id)),
      accounts: data.accounts.map((a) => toCanonicalAccount(a, itemId)),
      nextCursor: data.next_cursor,
      hasMore: data.has_more,
    };
  }

  /**
   * `/transactions/sync` does not echo the item_id. The caller already knows
   * it (it looked up the access token by item), so we only need a stable
   * placeholder here; SyncEngine overwrites it with the real value.
   */
  private itemIdHint(_data: TransactionsSyncResponse, accessToken: string): string {
    return createHash('sha256').update(accessToken).digest('hex').slice(0, 16);
  }

  async refresh(accessToken: string): Promise<boolean> {
    try {
      await this.client.transactionsRefresh({ access_token: accessToken });
      return true;
    } catch (err) {
      const body = plaidError(err);
      // Refresh is a paid add-on; treat "not enabled" as a soft no rather
      // than an error that would stop the sync pass.
      if (body?.error_code === 'PRODUCTS_NOT_SUPPORTED' || body?.error_code === 'PRODUCT_NOT_ENABLED') {
        logger.warn({ code: body.error_code }, '/transactions/refresh not available on this plan; relying on polling');
        return false;
      }
      throw this.translateError(err);
    }
  }

  /** Fetch item metadata so we can store the real item_id and institution. */
  async getItemInfo(accessToken: string): Promise<{ itemId: string; institutionId: string | null }> {
    try {
      const res = await this.client.itemGet({ access_token: accessToken });
      return {
        itemId: res.data.item.item_id,
        institutionId: res.data.item.institution_id ?? null,
      };
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async getInstitutionName(institutionId: string): Promise<string | null> {
    try {
      const res = await this.client.institutionsGetById({
        institution_id: institutionId,
        country_codes: this.config.plaidCountryCodes as never,
      });
      return res.data.institution.name;
    } catch {
      return null;
    }
  }

  async createLinkToken(userId: string, accessToken?: string): Promise<string> {
    try {
      const res = await this.client.linkTokenCreate({
        user: { client_user_id: userId },
        client_name: this.config.plaidLinkClientName,
        language: 'en',
        country_codes: this.config.plaidCountryCodes as never,
        // In update mode (re-auth) Plaid rejects `products`.
        ...(accessToken ? { access_token: accessToken } : { products: this.config.plaidProducts as never }),
        ...(this.config.publicBaseUrl ? { webhook: `${this.config.publicBaseUrl}/webhooks/plaid` } : {}),
      });
      return res.data.link_token;
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }> {
    try {
      const res = await this.client.itemPublicTokenExchange({ public_token: publicToken });
      return { accessToken: res.data.access_token, itemId: res.data.item_id };
    } catch (err) {
      throw this.translateError(err);
    }
  }

  /**
   * Verify the JWT in `Plaid-Verification`.
   *
   * The JWT does not contain the body — it contains the body's SHA-256. So
   * verification is two steps: check the signature against Plaid's published
   * key for the token's `kid`, then check that the body we received hashes to
   * the `request_body_sha256` claim. Skipping the second step would let
   * anyone replay a valid header with a body of their choosing.
   */
  async verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<boolean> {
    const header = headers['plaid-verification'] ?? headers['Plaid-Verification'];
    const token = Array.isArray(header) ? header[0] : header;
    if (!token) {
      logger.warn('webhook rejected: missing Plaid-Verification header');
      return false;
    }

    try {
      const { kid, alg } = decodeProtectedHeader(token);
      if (alg !== 'ES256') {
        logger.warn({ alg }, 'webhook rejected: unexpected JWT algorithm');
        return false;
      }
      if (!kid) {
        logger.warn('webhook rejected: JWT has no kid');
        return false;
      }

      const jwk = await this.getVerificationKey(kid);
      if (!jwk) return false;

      const keySet: JSONWebKeySet = { keys: [jwk] };
      const { payload } = await jwtVerify(token, createLocalJWKSet(keySet), { algorithms: ['ES256'] });

      const claimed = (payload as { request_body_sha256?: string }).request_body_sha256;
      if (!claimed) {
        logger.warn('webhook rejected: JWT missing request_body_sha256');
        return false;
      }

      const actual = createHash('sha256').update(rawBody, 'utf8').digest('hex');
      if (actual !== claimed) {
        logger.warn('webhook rejected: body hash mismatch');
        return false;
      }

      // Plaid's JWTs are short-lived; reject stale ones to blunt replay.
      const issuedAt = (payload as { iat?: number }).iat;
      if (issuedAt && Date.now() / 1000 - issuedAt > 5 * 60) {
        logger.warn('webhook rejected: verification token older than 5 minutes');
        return false;
      }
      return true;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'webhook rejected: JWT verification failed');
      return false;
    }
  }

  private async getVerificationKey(kid: string): Promise<JWK | undefined> {
    const cached = this.jwkCache.get(kid);
    if (cached) return cached;
    try {
      const res = await this.client.webhookVerificationKeyGet({ key_id: kid });
      const key = res.data.key as unknown as JWK;
      this.jwkCache.set(kid, key);
      return key;
    } catch (err) {
      logger.warn({ kid, err: (err as Error).message }, 'could not fetch webhook verification key');
      return undefined;
    }
  }

  private translateError(err: unknown): Error {
    const body = plaidError(err);
    if (!body) return err as Error;

    const code = body.error_code ?? '';
    const message = body.error_message ?? code;

    if (code === 'INVALID_API_KEYS' || code === 'INVALID_CLIENT_ID' || code === 'INVALID_SECRET') {
      // By far the most common cause is the environment/secret mismatch:
      // Plaid issues a *different* secret per environment, so flipping
      // PLAID_ENV without also swapping PLAID_SECRET fails exactly here.
      return new ProviderConfigError(
        `Plaid ${code}: ${message}`,
        `PLAID_CLIENT_ID/PLAID_SECRET were rejected for PLAID_ENV=${this.config.plaidEnv}. ` +
          `Plaid issues a separate secret per environment — check that PLAID_SECRET is the ` +
          `${this.config.plaidEnv} one at https://dashboard.plaid.com/developers/keys, and that ` +
          `neither value has stray whitespace or quotes.`,
      );
    }
    if (code === 'ITEM_LOGIN_REQUIRED' || code === 'ITEM_LOCKED' || body.error_type === 'ITEM_ERROR') {
      return new ProviderReauthRequired(`${code}: ${message}`);
    }
    if (code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' || code === 'INVALID_CURSOR') {
      // Plaid asks us to restart pagination from scratch when the underlying
      // data mutated mid-pagination.
      return new ProviderCursorInvalid(`${code}: ${message}`);
    }
    if (body.error_type === 'RATE_LIMIT_EXCEEDED') {
      return new ProviderRateLimited(`${code}: ${message}`);
    }
    return new Error(`Plaid ${code}: ${message}`);
  }
}
