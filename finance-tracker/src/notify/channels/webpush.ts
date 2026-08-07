import webpush from 'web-push';
import type { Config } from '../../config.js';
import type { DB } from '../../db/index.js';
import { logger } from '../../logger.js';
import type { DeliveryResult, NotificationMessage, Notifier } from '../types.js';

interface SubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string | null;
  failures: number;
}

/**
 * W3C Web Push (VAPID). Delivers to browsers, and to installed PWAs on iOS
 * 16.4+ — the only route to a real iPhone notification that costs nothing and
 * needs no Apple Developer account.
 *
 * Unlike the other channels this one fans out: every registered device gets
 * its own delivery, and subscriptions that the push service reports as gone
 * (404/410) are pruned rather than retried forever.
 */
export class WebPushNotifier implements Notifier {
  readonly channel = 'webpush';

  constructor(
    private readonly config: Config,
    private readonly db: DB,
  ) {
    if (this.isConfigured()) {
      webpush.setVapidDetails(config.vapidSubject!, config.vapidPublicKey!, config.vapidPrivateKey!);
    }
  }

  isConfigured(): boolean {
    return Boolean(this.config.vapidPublicKey && this.config.vapidPrivateKey && this.config.vapidSubject);
  }

  private subscriptions(): SubscriptionRow[] {
    return this.db
      .prepare('SELECT id, endpoint, p256dh, auth, label, failures FROM push_subscriptions')
      .all() as SubscriptionRow[];
  }

  async send(message: NotificationMessage): Promise<DeliveryResult[]> {
    const subs = this.subscriptions();
    if (subs.length === 0) {
      return [{ channel: this.channel, target: 'none', ok: false, error: 'no registered push subscriptions' }];
    }

    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url,
      tag: `event-${message.eventId}`,
      eventId: message.eventId,
    });

    return Promise.all(subs.map((sub) => this.sendOne(sub, payload, message.priority)));
  }

  private async sendOne(sub: SubscriptionRow, payload: string, priority: NotificationMessage['priority']): Promise<DeliveryResult> {
    const target = sub.label ?? sub.endpoint.slice(0, 60);
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { urgency: priority === 'high' ? 'high' : priority === 'low' ? 'low' : 'normal', TTL: 60 * 60 * 24 },
      );
      this.db.prepare("UPDATE push_subscriptions SET last_ok_at = datetime('now'), failures = 0 WHERE id = ?").run(sub.id);
      return { channel: this.channel, target, ok: true };
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      // The push service is telling us this device is permanently gone.
      if (statusCode === 404 || statusCode === 410) {
        this.db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        logger.info({ endpoint: sub.endpoint.slice(0, 40) }, 'pruned expired push subscription');
        return { channel: this.channel, target, ok: false, gone: true, error: `subscription expired (${statusCode})` };
      }
      this.db.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?').run(sub.id);
      return { channel: this.channel, target, ok: false, error: (err as Error).message };
    }
  }

  /** Register a browser/PWA subscription produced by `PushManager.subscribe`. */
  static register(db: DB, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, label?: string): void {
    db.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, label)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         p256dh = excluded.p256dh, auth = excluded.auth,
         label = COALESCE(excluded.label, push_subscriptions.label), failures = 0`,
    ).run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, label ?? null);
  }
}
