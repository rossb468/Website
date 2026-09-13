import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../config.js';
import type { Repositories } from '../db/repositories.js';
import type { Orchestrator } from '../core/orchestrator.js';
import { TimelineService } from '../core/timeline.js';
import type { NotificationDispatcher } from '../notify/dispatcher.js';
import { WebPushNotifier } from '../notify/channels/webpush.js';
import { PlaidProvider } from '../providers/plaid.js';
import { ProviderConfigError, type FinancialDataProvider } from '../providers/types.js';
import { logger } from '../logger.js';
import type { EventType } from '../core/types.js';
import { EVENT_TYPES } from '../core/types.js';

export interface ServerDeps {
  config: Config;
  repos: Repositories;
  provider: FinancialDataProvider;
  orchestrator: Orchestrator;
  dispatcher: NotificationDispatcher;
}

/** Constant-time bearer check, so the token cannot be probed byte by byte. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Express 5 widens route params to `string | string[]`; we only use scalars. */
function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function requireAuth(config: Config) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!config.apiToken) {
      // No token configured: allow only loopback, so an unconfigured
      // instance is usable locally but never accidentally world-readable.
      const ip = req.ip ?? '';
      if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
      res.status(401).json({ error: 'API_TOKEN is not configured; remote access refused' });
      return;
    }

    const header = req.get('authorization') ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!provided || !tokenMatches(provided, config.apiToken)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}

export function createApp(deps: ServerDeps): Express {
  const { config, repos, provider, orchestrator, dispatcher } = deps;
  const app = express();
  const timeline = new TimelineService(repos);
  const auth = requireAuth(config);

  app.set('trust proxy', true);
  app.disable('x-powered-by');

  // Webhooks need the byte-exact body to verify the signature hash, so this
  // route takes the raw body and must be registered before the JSON parser.
  app.post(
    '/webhooks/plaid',
    express.raw({ type: '*/*', limit: '1mb' }),
    async (req: Request, res: Response) => {
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');

      if (config.verifyPlaidWebhooks && provider.verifyWebhook) {
        const valid = await provider.verifyWebhook(rawBody, req.headers);
        if (!valid) {
          res.status(401).json({ error: 'invalid webhook signature' });
          return;
        }
      }

      let payload: { webhook_type?: string; webhook_code?: string; item_id?: string };
      try {
        payload = JSON.parse(rawBody);
      } catch {
        res.status(400).json({ error: 'malformed JSON' });
        return;
      }

      const { webhook_type: type, webhook_code: code, item_id: itemId } = payload;
      logger.info({ type, code, itemId }, 'webhook received');

      // Acknowledge immediately. Plaid retries on non-2xx and times out
      // quickly, and a sync can take longer than that window.
      res.status(200).json({ received: true });

      if (type !== 'TRANSACTIONS' || !itemId) return;

      const shouldSync = [
        'SYNC_UPDATES_AVAILABLE',
        'INITIAL_UPDATE',
        'HISTORICAL_UPDATE',
        'DEFAULT_UPDATE',
        'TRANSACTIONS_REMOVED',
      ].includes(code ?? '');

      if (!shouldSync) return;

      try {
        await orchestrator.syncItem(itemId, 'webhook');
      } catch (err) {
        logger.error({ itemId, err: (err as Error).message }, 'webhook-triggered sync failed');
      }
    },
  );

  app.use(express.json({ limit: '1mb' }));

  // -- connect a bank -------------------------------------------------------

  // Plaid Link is a browser widget, so connecting an account needs a real
  // page to host it. Served from the app itself so there is nothing else to
  // deploy and the page can talk to the API on the same origin.
  // `src/server/` and `dist/server/` are both two levels below the project
  // root, so this resolves identically under tsx and under node.
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
  app.get('/link', (_req, res) => {
    res.sendFile(join(publicDir, 'link.html'));
  });
  app.get('/', (_req, res) => res.redirect('/link'));

  // -- health ---------------------------------------------------------------

  app.get('/health', (_req, res) => {
    const items = repos.items.listAll();
    res.json({
      status: 'ok',
      provider: provider.name,
      // Lets the Link page warn you when you are one click from a real bank
      // login rather than the sandbox.
      plaidEnv: provider.name === 'plaid' ? config.plaidEnv : null,
      channels: dispatcher.channels,
      items: items.map((i) => ({
        itemId: i.item_id,
        institution: i.institution_name,
        status: i.status,
        lastSyncedAt: i.last_synced_at,
        consecutiveErrors: i.consecutive_errors,
        lastError: i.last_error,
      })),
      notifications: dispatcher.stats(),
      ...timeline.summary(),
    });
  });

  // -- Plaid Link -----------------------------------------------------------

  /**
   * Mint a Link token. Pass `?itemId=` to open Link in update mode, which is
   * how a connection in `needs_reauth` gets repaired.
   */
  app.post('/api/link/token', auth, async (req: Request, res: Response) => {
    if (!(provider instanceof PlaidProvider)) {
      res.status(400).json({ error: `Link is Plaid-specific; active provider is "${provider.name}"` });
      return;
    }
    try {
      const itemId = typeof req.query.itemId === 'string' ? req.query.itemId : undefined;
      const accessToken = itemId ? repos.items.get(itemId)?.access_token : undefined;
      const token = await provider.createLinkToken(String(req.body?.userId ?? 'primary-user'), accessToken);
      res.json({ linkToken: token });
    } catch (err) {
      // A credentials problem is the single most likely reason this fails, and
      // it is the one the person staring at the page can actually fix — so
      // pass the remedy through instead of a bare status code.
      const remedy = err instanceof ProviderConfigError ? err.remedy : undefined;
      logger.error({ err: (err as Error).message, remedy }, 'link token creation failed');
      res.status(502).json({ error: (err as Error).message, remedy });
    }
  });

  /** Exchange the public token Link returns for a durable access token. */
  app.post('/api/link/exchange', auth, async (req: Request, res: Response) => {
    if (!(provider instanceof PlaidProvider)) {
      res.status(400).json({ error: `Link is Plaid-specific; active provider is "${provider.name}"` });
      return;
    }
    const publicToken = req.body?.publicToken;
    if (typeof publicToken !== 'string' || !publicToken) {
      res.status(400).json({ error: 'publicToken is required' });
      return;
    }

    try {
      const { accessToken, itemId } = await provider.exchangePublicToken(publicToken);
      const info = await provider.getItemInfo(accessToken);
      const institutionName = info.institutionId ? await provider.getInstitutionName(info.institutionId) : null;

      repos.items.upsert({
        itemId,
        provider: provider.name,
        accessToken,
        institutionId: info.institutionId,
        institutionName,
      });

      // First sync pulls history and establishes the cursor.
      const result = await orchestrator.syncItem(itemId, 'backfill');
      res.json({ itemId, institution: institutionName, initialEvents: result.events.length });
    } catch (err) {
      const remedy = err instanceof ProviderConfigError ? err.remedy : undefined;
      logger.error({ err: (err as Error).message, remedy }, 'public token exchange failed');
      res.status(502).json({ error: (err as Error).message, remedy });
    }
  });

  // -- timeline (feature 2) -------------------------------------------------

  function parseTypes(raw: unknown): EventType[] | undefined {
    if (typeof raw !== 'string' || !raw) return undefined;
    const allowed = new Set<string>(EVENT_TYPES);
    const parsed = raw.split(',').map((t) => t.trim()).filter((t) => allowed.has(t)) as EventType[];
    return parsed.length ? parsed : undefined;
  }

  app.get('/api/timeline', auth, (req: Request, res: Response) => {
    const entries = timeline.list({
      accountId: typeof req.query.accountId === 'string' ? req.query.accountId : undefined,
      types: parseTypes(req.query.types),
      since: typeof req.query.since === 'string' ? req.query.since : undefined,
      until: typeof req.query.until === 'string' ? req.query.until : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 100,
      beforeId: req.query.beforeId ? Number(req.query.beforeId) : undefined,
      order: req.query.order === 'asc' ? 'asc' : 'desc',
    });

    res.json({
      entries,
      // Keyset cursor: pass back as `beforeId` for the next page.
      nextBeforeId: entries.length ? entries[entries.length - 1]!.id : null,
      unresolvedPending: timeline.unresolved(
        typeof req.query.accountId === 'string' ? req.query.accountId : undefined,
      ),
    });
  });

  /** Every event for one purchase — authorization through settlement. */
  app.get('/api/timeline/lifecycle/:id', auth, (req: Request, res: Response) => {
    const result = timeline.lifecycle(param(req, 'id'));
    if (result.events.length === 0 && result.records.length === 0) {
      res.status(404).json({ error: 'unknown lifecycle' });
      return;
    }
    res.json(result);
  });

  /** Full observed version history of a single transaction record. */
  app.get('/api/transactions/:id/versions', auth, (req: Request, res: Response) => {
    const versions = repos.transactions.listVersions(param(req, 'id'));
    if (versions.length === 0) {
      res.status(404).json({ error: 'unknown transaction' });
      return;
    }
    res.json({ transactionId: param(req, 'id'), versions });
  });

  // -- accounts -------------------------------------------------------------

  app.get('/api/accounts', auth, (_req, res) => {
    res.json({
      accounts: repos.accounts.list().map((a) => ({
        accountId: a.account_id,
        itemId: a.item_id,
        name: a.name,
        mask: a.mask,
        type: a.type,
        subtype: a.subtype,
        currency: a.currency,
        currentBalance: a.current_balance,
        availableBalance: a.available_balance,
        notifyEnabled: a.notify_enabled === 1,
        notifyMinAmount: a.notify_min_amount,
      })),
    });
  });

  /** Per-account notification preferences (feature 1 targeting). */
  app.patch('/api/accounts/:id/notifications', auth, (req: Request, res: Response) => {
    try {
      repos.accounts.setNotifyPreferences(param(req, 'id'), {
        enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
        minAmount: typeof req.body?.minAmount === 'number' ? req.body.minAmount : undefined,
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  // -- push registration ----------------------------------------------------

  app.get('/api/push/public-key', auth, (_req, res) => {
    if (!config.vapidPublicKey) {
      res.status(404).json({ error: 'web push is not configured' });
      return;
    }
    res.json({ publicKey: config.vapidPublicKey });
  });

  app.post('/api/push/subscribe', auth, (req: Request, res: Response) => {
    const sub = req.body?.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      res.status(400).json({ error: 'a complete PushSubscription is required' });
      return;
    }
    WebPushNotifier.register(repos.db, sub, typeof req.body?.label === 'string' ? req.body.label : undefined);
    res.json({ ok: true });
  });

  // -- manual controls ------------------------------------------------------

  app.post('/api/sync', auth, async (req: Request, res: Response) => {
    try {
      const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : undefined;
      const results = itemId
        ? [await orchestrator.syncItem(itemId, 'manual')]
        : await orchestrator.syncAll('manual');
      res.json({
        results: results.map((r) => ({
          itemId: r.itemId,
          ok: r.ok,
          added: r.added,
          modified: r.modified,
          removed: r.removed,
          events: r.events.length,
          error: r.error,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/sync/runs', auth, (_req, res) => {
    res.json({ runs: repos.runs.recent(50) });
  });

  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: `no route for ${req.method} ${req.path}` });
  });

  // Express 5 forwards async rejections here.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: err.message, stack: err.stack }, 'unhandled request error');
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
