import 'dotenv/config';
import { z } from 'zod';

/** Comma-separated env var -> trimmed, non-empty string array. */
const csv = (fallback: string[] = []) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === ''
        ? fallback
        : v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    );

/** Env vars arrive as strings; treat the usual truthy spellings as true. */
const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()),
    );

const int = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? fallback : Number(v)))
    .pipe(z.number().int().positive());

/** Like `int` but allows 0 — used where "immediately" is a valid setting. */
const nonNegInt = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? fallback : Number(v)))
    .pipe(z.number().int().nonnegative());

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

export const NOTIFY_CHANNELS = ['console', 'ntfy', 'pushover', 'webpush'] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

const schema = z.object({
  provider: z.enum(['mock', 'plaid']).default('mock'),
  plaidEnv: z.enum(['sandbox', 'production']).default('sandbox'),
  databasePath: z.string().default('./data/finance.db'),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  port: int(4000),
  publicBaseUrl: optionalString,

  plaidClientId: optionalString,
  plaidSecret: optionalString,
  plaidProducts: csv(['transactions']),
  plaidCountryCodes: csv(['US']),
  plaidLinkClientName: z.string().default('Finance Tracker'),

  pollIntervalSeconds: int(300),
  enableTransactionsRefresh: bool(false),
  refreshMinIntervalSeconds: int(900),
  pendingLimboGraceHours: nonNegInt(72),

  notifyChannels: csv(['console']).pipe(z.array(z.enum(NOTIFY_CHANNELS))),
  ntfyServerUrl: z.string().default('https://ntfy.sh'),
  ntfyTopic: optionalString,
  ntfyToken: optionalString,
  pushoverToken: optionalString,
  pushoverUser: optionalString,
  vapidPublicKey: optionalString,
  vapidPrivateKey: optionalString,
  vapidSubject: optionalString,

  apiToken: optionalString,
  verifyPlaidWebhooks: bool(true),
});

export type Config = z.infer<typeof schema>;

function read(env: NodeJS.ProcessEnv) {
  return schema.parse({
    provider: env.PROVIDER,
    plaidEnv: env.PLAID_ENV,
    databasePath: env.DATABASE_PATH,
    logLevel: env.LOG_LEVEL,
    port: env.PORT,
    publicBaseUrl: env.PUBLIC_BASE_URL,

    plaidClientId: env.PLAID_CLIENT_ID,
    plaidSecret: env.PLAID_SECRET,
    plaidProducts: env.PLAID_PRODUCTS,
    plaidCountryCodes: env.PLAID_COUNTRY_CODES,
    plaidLinkClientName: env.PLAID_LINK_CLIENT_NAME,

    pollIntervalSeconds: env.POLL_INTERVAL_SECONDS,
    enableTransactionsRefresh: env.ENABLE_TRANSACTIONS_REFRESH,
    refreshMinIntervalSeconds: env.REFRESH_MIN_INTERVAL_SECONDS,
    pendingLimboGraceHours: env.PENDING_LIMBO_GRACE_HOURS,

    notifyChannels: env.NOTIFY_CHANNELS,
    ntfyServerUrl: env.NTFY_SERVER_URL,
    ntfyTopic: env.NTFY_TOPIC,
    ntfyToken: env.NTFY_TOKEN,
    pushoverToken: env.PUSHOVER_TOKEN,
    pushoverUser: env.PUSHOVER_USER,
    vapidPublicKey: env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: env.VAPID_PRIVATE_KEY,
    vapidSubject: env.VAPID_SUBJECT,

    apiToken: env.API_TOKEN,
    verifyPlaidWebhooks: env.VERIFY_PLAID_WEBHOOKS,
  });
}

/**
 * Config problems that should stop startup rather than surface later as a
 * confusing runtime failure (e.g. a notification channel that silently
 * drops every message because its credentials are blank).
 */
export function validateConfig(cfg: Config): string[] {
  const errors: string[] = [];

  if (cfg.provider === 'plaid') {
    if (!cfg.plaidClientId) errors.push('PROVIDER=plaid requires PLAID_CLIENT_ID');
    if (!cfg.plaidSecret) errors.push('PROVIDER=plaid requires PLAID_SECRET');
  }
  if (cfg.notifyChannels.includes('ntfy') && !cfg.ntfyTopic) {
    errors.push('NOTIFY_CHANNELS includes "ntfy" but NTFY_TOPIC is empty');
  }
  if (cfg.notifyChannels.includes('pushover') && !(cfg.pushoverToken && cfg.pushoverUser)) {
    errors.push('NOTIFY_CHANNELS includes "pushover" but PUSHOVER_TOKEN/PUSHOVER_USER are not both set');
  }
  if (cfg.notifyChannels.includes('webpush') && !(cfg.vapidPublicKey && cfg.vapidPrivateKey && cfg.vapidSubject)) {
    errors.push(
      'NOTIFY_CHANNELS includes "webpush" but VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT are not all set',
    );
  }
  if (cfg.refreshMinIntervalSeconds < cfg.pollIntervalSeconds && cfg.enableTransactionsRefresh) {
    errors.push('REFRESH_MIN_INTERVAL_SECONDS should be >= POLL_INTERVAL_SECONDS to avoid wasting refresh quota');
  }
  return errors;
}

let cached: Config | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  cached ??= read(env);
  return cached;
}

/** Test helper: build a config without touching the module-level cache. */
export function configFrom(env: Record<string, string | undefined>): Config {
  return read(env as NodeJS.ProcessEnv);
}
