import type { Config } from '../config.js';
import type { DB } from '../db/index.js';
import type { Repositories } from '../db/repositories.js';
import type { EventType, LedgerEvent } from '../core/types.js';
import { logger } from '../logger.js';
import { renderNotification } from './render.js';
import { ConsoleNotifier } from './channels/console.js';
import { NtfyNotifier } from './channels/ntfy.js';
import { PushoverNotifier } from './channels/pushover.js';
import { WebPushNotifier } from './channels/webpush.js';
import { DEFAULT_NOTIFY_TYPES, type Notifier } from './types.js';

const MAX_ATTEMPTS = 4;

interface PendingRow {
  id: number;
  event_id: number;
  channel: string;
  title: string;
  body: string;
  attempts: number;
}

/**
 * Decides which ledger events deserve a push, renders them and delivers them
 * to every configured channel.
 *
 * Delivery is recorded in the `notifications` table before the send is
 * attempted, with a unique constraint on `(event, channel)`. That makes the
 * whole path idempotent: a replayed sync, a webhook delivered twice, or a
 * crash between send and bookkeeping can never produce a second buzz for the
 * same change.
 */
export class NotificationDispatcher {
  private readonly notifiers: Notifier[];
  private readonly types: Set<EventType>;

  constructor(
    private readonly config: Config,
    private readonly repos: Repositories,
    notifiers?: Notifier[],
  ) {
    this.notifiers = notifiers ?? NotificationDispatcher.buildNotifiers(config, repos.db);
    this.types = new Set(DEFAULT_NOTIFY_TYPES);
  }

  static buildNotifiers(config: Config, db: DB): Notifier[] {
    const all: Record<string, () => Notifier> = {
      console: () => new ConsoleNotifier(),
      ntfy: () => new NtfyNotifier(config),
      pushover: () => new PushoverNotifier(config),
      webpush: () => new WebPushNotifier(config, db),
    };

    const selected: Notifier[] = [];
    for (const channel of config.notifyChannels) {
      const factory = all[channel];
      if (!factory) continue;
      const notifier = factory();
      if (!notifier.isConfigured()) {
        logger.warn({ channel }, 'notification channel selected but not configured; skipping');
        continue;
      }
      selected.push(notifier);
    }
    if (selected.length === 0) {
      logger.warn('no notification channels configured; falling back to console');
      selected.push(new ConsoleNotifier());
    }
    return selected;
  }

  /** Should this event raise a push at all? */
  shouldNotify(event: LedgerEvent): boolean {
    if (!this.types.has(event.type)) return false;

    // Connection failures are account-independent but always worth knowing:
    // a silent tracker looks exactly like a quiet account. An institution
    // that is down for hours would otherwise alert on every poll, so back the
    // alerts off exponentially — failure 1, 2, 4, 8, … — which reports the
    // problem promptly and then stops shouting about it.
    if (event.type === 'sync.error') {
      const attempt = typeof event.metadata?.consecutiveErrors === 'number' ? event.metadata.consecutiveErrors : 1;
      return attempt <= 1 || (attempt & (attempt - 1)) === 0;
    }

    if (!event.accountId) return false;
    const account = this.repos.accounts.get(event.accountId);
    if (!account || account.notify_enabled !== 1) return false;

    const magnitude = Math.abs(event.amount ?? 0);
    if (account.notify_min_amount > 0 && magnitude < account.notify_min_amount) return false;

    return true;
  }

  /**
   * Queue and deliver notifications for a batch of events.
   * Returns the number actually sent.
   */
  async dispatch(events: LedgerEvent[]): Promise<number> {
    const queued: PendingRow[] = [];

    for (const event of events) {
      if (!this.shouldNotify(event)) continue;

      const accountName = event.accountId
        ? (this.repos.accounts.get(event.accountId)?.name ?? null)
        : null;
      const message = renderNotification(event, accountName, this.config.publicBaseUrl);

      for (const notifier of this.notifiers) {
        const row = this.enqueue(event.id, notifier.channel, message.title, message.body);
        if (row) queued.push(row);
      }
    }

    if (queued.length === 0) return 0;
    return this.flush(queued);
  }

  /**
   * Claim a (event, channel) pair. Returns undefined when it was already
   * claimed, which is what makes redelivery impossible.
   */
  private enqueue(eventId: number, channel: string, title: string, body: string): PendingRow | undefined {
    const dedupeKey = `${eventId}:${channel}`;
    const info = this.repos.db
      .prepare(
        `INSERT INTO notifications (event_id, channel, dedupe_key, title, body)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(dedupe_key) DO NOTHING`,
      )
      .run(eventId, channel, dedupeKey, title, body);

    if (info.changes === 0) {
      logger.debug({ eventId, channel }, 'notification already queued; skipping duplicate');
      return undefined;
    }
    return { id: Number(info.lastInsertRowid), event_id: eventId, channel, title, body, attempts: 0 };
  }

  private async flush(rows: PendingRow[]): Promise<number> {
    let sent = 0;

    for (const row of rows) {
      const notifier = this.notifiers.find((n) => n.channel === row.channel);
      if (!notifier) {
        this.markSkipped(row.id, 'channel no longer configured');
        continue;
      }

      const event = this.repos.ledger.byId(row.event_id);
      if (!event) {
        this.markSkipped(row.id, 'event disappeared');
        continue;
      }

      const accountName = event.accountId ? (this.repos.accounts.get(event.accountId)?.name ?? null) : null;
      const message = renderNotification(event, accountName, this.config.publicBaseUrl);

      try {
        const results = await notifier.send(message);
        const ok = results.some((r) => r.ok);
        if (ok) {
          this.markSent(row.id);
          sent += 1;
        } else {
          this.markFailed(row.id, results.map((r) => r.error).filter(Boolean).join('; ') || 'delivery failed');
        }
      } catch (err) {
        this.markFailed(row.id, (err as Error).message);
      }
    }

    return sent;
  }

  /**
   * Re-attempt deliveries that failed earlier. Called by the scheduler, so a
   * transient outage at ntfy or Pushover delays a notification rather than
   * losing it.
   */
  async retryFailed(limit = 50): Promise<number> {
    const rows = this.repos.db
      .prepare(
        `SELECT id, event_id, channel, title, body, attempts
           FROM notifications
          WHERE status = 'failed' AND attempts < ?
          ORDER BY created_at
          LIMIT ?`,
      )
      .all(MAX_ATTEMPTS, limit) as PendingRow[];

    if (rows.length === 0) return 0;
    logger.info({ count: rows.length }, 'retrying failed notifications');
    return this.flush(rows);
  }

  private markSent(id: number): void {
    this.repos.db
      .prepare("UPDATE notifications SET status = 'sent', sent_at = datetime('now'), attempts = attempts + 1 WHERE id = ?")
      .run(id);
  }

  private markFailed(id: number, error: string): void {
    this.repos.db
      .prepare(
        `UPDATE notifications
            SET status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'failed' END,
                attempts = attempts + 1,
                last_error = ?
          WHERE id = ?`,
      )
      .run(MAX_ATTEMPTS, error, id);
    logger.warn({ notificationId: id, error }, 'notification delivery failed');
  }

  private markSkipped(id: number, reason: string): void {
    this.repos.db.prepare("UPDATE notifications SET status = 'skipped', last_error = ? WHERE id = ?").run(reason, id);
  }

  /** Delivery stats for the health endpoint. */
  stats(): Record<string, number> {
    const rows = this.repos.db.prepare('SELECT status, COUNT(*) AS n FROM notifications GROUP BY status').all() as Array<{
      status: string;
      n: number;
    }>;
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  get channels(): string[] {
    return this.notifiers.map((n) => n.channel);
  }
}
