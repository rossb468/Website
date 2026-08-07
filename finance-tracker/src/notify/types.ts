import type { EventType, LedgerEvent } from '../core/types.js';

/** A rendered, ready-to-deliver notification. */
export interface NotificationMessage {
  /** Ledger event this came from. Used for the delivery log and dedupe. */
  eventId: number;
  title: string;
  body: string;
  /** 'high' asks the transport to bypass quiet hours where supported. */
  priority: 'low' | 'normal' | 'high';
  /** Deep link back into the timeline, when a public URL is configured. */
  url?: string;
  tags?: string[];
  event: LedgerEvent;
}

export interface DeliveryResult {
  channel: string;
  target: string;
  ok: boolean;
  error?: string;
  /** Set when the target is permanently gone (e.g. expired push subscription). */
  gone?: boolean;
}

/**
 * A delivery transport. Adding a channel — Telegram, SMS, APNs, a webhook to
 * Home Assistant — means implementing this and registering it; nothing else
 * in the system changes.
 */
export interface Notifier {
  readonly channel: string;
  /** False when credentials are missing, so the router can skip it cleanly. */
  isConfigured(): boolean;
  send(message: NotificationMessage): Promise<DeliveryResult[]>;
}

/** Which events are worth a push, per account. */
export interface NotificationRules {
  enabled: boolean;
  /** Ignore movements smaller than this, in minor units. */
  minAmount: number;
  types: Set<EventType>;
}

/**
 * Default event selection.
 *
 * `transaction.changed` is deliberately excluded: providers recategorize and
 * re-describe transactions constantly, and pushing every one of those trains
 * the user to ignore the notifications. Those changes still land in the
 * ledger, which is where they belong.
 */
export const DEFAULT_NOTIFY_TYPES: EventType[] = [
  'transaction.added',
  'transaction.posted',
  'transaction.vanished',
  'transaction.removed',
];
