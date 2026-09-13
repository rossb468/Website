import { describe, it, expect } from 'vitest';
import { PlaidProvider, toCanonicalAccount, toCanonicalTransaction } from '../src/providers/plaid.js';
import { ProviderConfigError, ProviderCursorInvalid, ProviderReauthRequired } from '../src/providers/types.js';
import { configFrom } from '../src/config.js';
import type { Transaction as PlaidTransaction, AccountBase } from 'plaid';

const config = (over: Record<string, string> = {}) =>
  configFrom({
    PROVIDER: 'plaid',
    PLAID_ENV: 'sandbox',
    PLAID_CLIENT_ID: 'test-client',
    PLAID_SECRET: 'test-secret',
    LOG_LEVEL: 'silent',
    DATABASE_PATH: ':memory:',
    ...over,
  });

/** Shape an Axios-style Plaid failure the way the SDK surfaces it. */
const plaidFailure = (errorCode: string, errorType = 'INVALID_INPUT') => ({
  response: { data: { error_code: errorCode, error_type: errorType, error_message: `${errorCode} happened` } },
});

/** translateError is private; exercise it through the public surface. */
function translate(provider: PlaidProvider, err: unknown): Error {
  return (provider as unknown as { translateError(e: unknown): Error }).translateError(err);
}

describe('Plaid error classification', () => {
  it('classifies rejected credentials as a config error with an actionable remedy', () => {
    const provider = new PlaidProvider(config({ PLAID_ENV: 'production' }));
    const err = translate(provider, plaidFailure('INVALID_API_KEYS'));

    expect(err).toBeInstanceOf(ProviderConfigError);
    const remedy = (err as ProviderConfigError).remedy;
    // Must name the environment actually in use — the mismatch between
    // PLAID_ENV and PLAID_SECRET is the overwhelmingly common cause.
    expect(remedy).toContain('production');
    expect(remedy).toContain('PLAID_SECRET');
    expect(remedy).toContain('separate secret per environment');
  });

  it('treats a stale bank login as needing re-auth, not a config problem', () => {
    const provider = new PlaidProvider(config());
    const err = translate(provider, plaidFailure('ITEM_LOGIN_REQUIRED', 'ITEM_ERROR'));
    expect(err).toBeInstanceOf(ProviderReauthRequired);
    expect(err).not.toBeInstanceOf(ProviderConfigError);
  });

  it('asks for a pagination restart when the cursor is rejected', () => {
    const provider = new PlaidProvider(config());
    expect(translate(provider, plaidFailure('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'))).toBeInstanceOf(
      ProviderCursorInvalid,
    );
  });

  it('passes an unrecognised Plaid error through with its code intact', () => {
    const provider = new PlaidProvider(config());
    const err = translate(provider, plaidFailure('INTERNAL_SERVER_ERROR', 'API_ERROR'));
    expect(err.message).toContain('INTERNAL_SERVER_ERROR');
    expect(err).not.toBeInstanceOf(ProviderConfigError);
  });

  it('refuses to construct without credentials', () => {
    expect(() => new PlaidProvider(configFrom({ PROVIDER: 'plaid', DATABASE_PATH: ':memory:' }))).toThrow(
      /PLAID_CLIENT_ID/,
    );
  });
});

// ---------------------------------------------------------------------------
// Normalization — the boundary where Plaid's conventions become ours
// ---------------------------------------------------------------------------

const plaidTx = (over: Partial<PlaidTransaction> = {}): PlaidTransaction =>
  ({
    account_id: 'acc-1',
    // Plaid: POSITIVE means money left the account.
    amount: 71.3,
    iso_currency_code: 'USD',
    unofficial_currency_code: null,
    date: '2026-03-11',
    authorized_date: '2026-03-10',
    name: 'SQ *TARTINE MANUFACTORY',
    merchant_name: 'Tartine Manufactory',
    pending: false,
    pending_transaction_id: 'pending-abc',
    transaction_id: 'posted-xyz',
    account_owner: null,
    location: {} as never,
    payment_meta: {} as never,
    personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_RESTAURANT' } as never,
    payment_channel: 'in store',
    logo_url: 'https://example.com/logo.png',
    website: 'tartine.com',
    ...over,
  }) as PlaidTransaction;

describe('Plaid transaction normalization', () => {
  it('flips the sign so negative means money left the account', () => {
    // Plaid's +71.30 debit becomes -7130 cents. Getting this backwards would
    // invert every amount delta in the ledger.
    expect(toCanonicalTransaction(plaidTx()).amount).toBe(-7_130);
  });

  it('flips inflows to positive', () => {
    expect(toCanonicalTransaction(plaidTx({ amount: -250.0 })).amount).toBe(25_000);
  });

  it('converts to integer cents without float drift', () => {
    expect(toCanonicalTransaction(plaidTx({ amount: 19.99 })).amount).toBe(-1_999);
    expect(toCanonicalTransaction(plaidTx({ amount: 0.1 })).amount).toBe(-10);
  });

  it('honours currencies whose minor unit is not 1/100', () => {
    const tx = toCanonicalTransaction(plaidTx({ amount: 1500, iso_currency_code: 'JPY' }));
    expect(tx.amount).toBe(-1_500);
    expect(tx.currency).toBe('JPY');
  });

  it('falls back to the unofficial currency code', () => {
    const tx = toCanonicalTransaction(
      plaidTx({ iso_currency_code: null, unofficial_currency_code: 'BTC' } as Partial<PlaidTransaction>),
    );
    expect(tx.currency).toBe('BTC');
  });

  it('carries the pending link through, which is what makes stitching work', () => {
    const tx = toCanonicalTransaction(plaidTx());
    expect(tx.pendingTransactionId).toBe('pending-abc');
    expect(tx.transactionId).toBe('posted-xyz');
    expect(tx.pending).toBe(false);
  });

  it('prefers the modern personal finance category', () => {
    const tx = toCanonicalTransaction(plaidTx());
    expect(tx.category).toBe('FOOD_AND_DRINK');
    expect(tx.categoryDetailed).toBe('FOOD_AND_DRINK_RESTAURANT');
  });

  it('falls back to the legacy category when the modern one is absent', () => {
    const tx = toCanonicalTransaction(
      plaidTx({ personal_finance_category: null, category: ['Travel', 'Airlines'] } as Partial<PlaidTransaction>),
    );
    expect(tx.category).toBe('Travel');
  });

  it('preserves the raw payload for later backfills', () => {
    expect(toCanonicalTransaction(plaidTx()).raw).toMatchObject({ transaction_id: 'posted-xyz' });
  });
});

describe('Plaid account normalization', () => {
  const account = (over: Partial<AccountBase['balances']> = {}): AccountBase =>
    ({
      account_id: 'acc-1',
      name: 'Everyday Checking',
      official_name: 'Everyday Checking Account',
      mask: '4471',
      type: 'depository',
      subtype: 'checking',
      balances: {
        current: 4823.55,
        available: 4701.0,
        limit: null,
        iso_currency_code: 'USD',
        unofficial_currency_code: null,
        ...over,
      },
    }) as AccountBase;

  it('converts balances to integer cents', () => {
    const a = toCanonicalAccount(account(), 'item-1');
    expect(a.currentBalance).toBe(482_355);
    expect(a.availableBalance).toBe(470_100);
    expect(a.itemId).toBe('item-1');
  });

  it('keeps missing balances null rather than coercing them to zero', () => {
    // A null balance and a zero balance mean very different things; conflating
    // them would fabricate balance.changed events.
    const a = toCanonicalAccount(account({ available: null, current: null }), 'item-1');
    expect(a.currentBalance).toBeNull();
    expect(a.availableBalance).toBeNull();
  });

  it('carries a credit limit when present', () => {
    expect(toCanonicalAccount(account({ limit: 5000 }), 'item-1').creditLimit).toBe(500_000);
  });
});
