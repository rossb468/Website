import type { LedgerEvent } from '../core/types.js';
import { formatAmount, formatMagnitude } from '../core/money.js';
import { describeChanges } from '../core/diff.js';
import type { NotificationMessage } from './types.js';

/**
 * Turn a ledger event into push copy.
 *
 * A push notification gets about one second of attention, so the title
 * carries the two things that matter — how much, and to whom — and the body
 * explains what kind of change it was.
 */
export function renderNotification(event: LedgerEvent, accountName: string | null, baseUrl?: string): NotificationMessage {
  const currency = event.currency ?? 'USD';
  const who = event.description ?? 'Transaction';
  const amount = event.amount === null ? null : formatMagnitude(event.amount, currency);
  const account = accountName ?? 'account';
  const inflow = (event.amount ?? 0) > 0;

  let title: string;
  let body: string;
  let priority: NotificationMessage['priority'] = 'normal';
  const tags: string[] = [];

  switch (event.type) {
    case 'transaction.added':
      title = event.pending
        ? `${amount} pending at ${who}`
        : `${amount} ${inflow ? 'received' : 'charged'} at ${who}`;
      body = `${event.pending ? 'Authorized' : 'Posted'} on ${account}`;
      tags.push(inflow ? 'inbox_tray' : 'credit_card');
      break;

    case 'transaction.posted': {
      const delta = event.amountDelta ?? 0;
      const grew = inflow ? delta > 0 : delta < 0;
      if (delta !== 0) {
        // The headline case: a charge that settled for a different amount
        // than it was authorized for.
        const meta = event.metadata ?? {};
        const authorized = typeof meta.pendingAmount === 'number' ? formatMagnitude(meta.pendingAmount, currency) : null;
        title = `${who}: ${amount}${grew ? ' ↑' : ' ↓'}`;
        body = authorized
          ? `Settled ${amount} — authorized ${authorized} (${grew ? '+' : '−'}${formatMagnitude(delta, currency)}) on ${account}`
          : `Settled ${amount}, ${grew ? 'up' : 'down'} ${formatMagnitude(delta, currency)} on ${account}`;
        priority = 'high';
        tags.push(grew ? 'chart_with_upwards_trend' : 'chart_with_downwards_trend');
      } else {
        title = `${amount} posted at ${who}`;
        body = `Settled for the authorized amount on ${account}`;
        tags.push('white_check_mark');
      }
      break;
    }

    case 'transaction.vanished':
      title = `${amount} at ${who} disappeared`;
      body = `A pending charge on ${account} was dropped and never posted. It will not appear in your bank's transaction history.`;
      priority = 'high';
      tags.push('ghost');
      break;

    case 'transaction.removed':
      title = `${amount} at ${who} was removed`;
      body = `Your bank withdrew this posted transaction from ${account}.`;
      priority = 'high';
      tags.push('wastebasket');
      break;

    case 'transaction.changed': {
      const what = event.changes ? describeChanges(event.changes) : 'updated';
      title = `${who}: ${what}`;
      body =
        event.amountDelta && event.amountDelta !== 0
          ? `Now ${amount} on ${account} (${formatAmount(event.amountDelta, currency, { signed: true })})`
          : `Updated on ${account}`;
      priority = 'low';
      tags.push('pencil2');
      break;
    }

    case 'balance.changed':
      title = `${account}: ${formatAmount(event.amount ?? 0, currency)}`;
      body = `Balance moved ${formatAmount(event.amountDelta ?? 0, currency, { signed: true })}`;
      priority = 'low';
      tags.push('bank');
      break;

    case 'sync.error':
      title = 'Bank connection problem';
      body = event.description ?? 'A sync attempt failed.';
      priority = 'high';
      tags.push('warning');
      break;

    default:
      title = who;
      body = `Change on ${account}`;
  }

  const message: NotificationMessage = { eventId: event.id, title, body, priority, tags, event };
  if (baseUrl) {
    message.url = event.lifecycleId
      ? `${baseUrl}/api/timeline/lifecycle/${event.lifecycleId}`
      : `${baseUrl}/api/timeline`;
  }
  return message;
}
