import type { Config } from '../../config.js';
import type { DeliveryResult, NotificationMessage, Notifier } from '../types.js';

/**
 * Pushover — one-time purchase per platform, very reliable iOS delivery.
 *
 * Worth the money over ntfy if you want the notification to survive iOS's
 * aggressive background throttling and to reach you during a Focus mode
 * (priority 1 bypasses quiet hours).
 */
export class PushoverNotifier implements Notifier {
  readonly channel = 'pushover';
  private static readonly ENDPOINT = 'https://api.pushover.net/1/messages.json';

  constructor(private readonly config: Config) {}

  isConfigured(): boolean {
    return Boolean(this.config.pushoverToken && this.config.pushoverUser);
  }

  async send(message: NotificationMessage): Promise<DeliveryResult[]> {
    const target = 'pushover';
    const params = new URLSearchParams({
      token: this.config.pushoverToken!,
      user: this.config.pushoverUser!,
      title: message.title,
      message: message.body,
      priority: message.priority === 'high' ? '1' : message.priority === 'low' ? '-1' : '0',
    });
    if (message.url) {
      params.set('url', message.url);
      params.set('url_title', 'Open timeline');
    }

    try {
      const res = await fetch(PushoverNotifier.ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(10_000),
      });
      const payload = (await res.json().catch(() => ({}))) as { status?: number; errors?: string[] };
      if (!res.ok || payload.status !== 1) {
        return [
          {
            channel: this.channel,
            target,
            ok: false,
            error: payload.errors?.join('; ') ?? `HTTP ${res.status}`,
          },
        ];
      }
      return [{ channel: this.channel, target, ok: true }];
    } catch (err) {
      return [{ channel: this.channel, target, ok: false, error: (err as Error).message }];
    }
  }
}
