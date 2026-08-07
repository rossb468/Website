import { logger } from '../../logger.js';
import type { DeliveryResult, NotificationMessage, Notifier } from '../types.js';

/**
 * Prints instead of pushing. The default channel, so a fresh checkout runs
 * end to end with no accounts, no keys and no devices.
 */
export class ConsoleNotifier implements Notifier {
  readonly channel = 'console';

  isConfigured(): boolean {
    return true;
  }

  async send(message: NotificationMessage): Promise<DeliveryResult[]> {
    logger.info({ eventId: message.eventId, priority: message.priority }, `[notify] ${message.title} — ${message.body}`);
    return [{ channel: this.channel, target: 'stdout', ok: true }];
  }
}
