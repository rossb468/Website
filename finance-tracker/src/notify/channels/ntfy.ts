import type { Config } from '../../config.js';
import type { DeliveryResult, NotificationMessage, Notifier } from '../types.js';

/**
 * ntfy.sh — publish to a topic over plain HTTP; the phone app subscribes.
 *
 * The lowest-friction option by a wide margin: no developer account, no
 * device registration, free, self-hostable, and it works on both iOS and
 * Android. The tradeoff is that the topic name *is* the credential, so it
 * must be long and unguessable (or the server protected with a token).
 */
export class NtfyNotifier implements Notifier {
  readonly channel = 'ntfy';

  constructor(private readonly config: Config) {}

  isConfigured(): boolean {
    return Boolean(this.config.ntfyTopic);
  }

  async send(message: NotificationMessage): Promise<DeliveryResult[]> {
    const topic = this.config.ntfyTopic!;
    const target = `${this.config.ntfyServerUrl}/${topic}`;

    const headers: Record<string, string> = {
      Title: sanitizeHeader(message.title),
      Priority: message.priority === 'high' ? '4' : message.priority === 'low' ? '2' : '3',
    };
    if (message.tags?.length) headers.Tags = message.tags.join(',');
    if (message.url) headers.Click = message.url;
    if (this.config.ntfyToken) headers.Authorization = `Bearer ${this.config.ntfyToken}`;

    try {
      const res = await fetch(target, {
        method: 'POST',
        headers,
        body: message.body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        return [{ channel: this.channel, target, ok: false, error: `HTTP ${res.status}: ${await safeText(res)}` }];
      }
      return [{ channel: this.channel, target, ok: true }];
    } catch (err) {
      return [{ channel: this.channel, target, ok: false, error: (err as Error).message }];
    }
  }
}

/**
 * ntfy carries the title in an HTTP header, so anything non-ASCII or with a
 * newline in it would produce an invalid request. Merchant names routinely
 * contain both.
 */
function sanitizeHeader(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .slice(0, 200);
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return '<no body>';
  }
}
