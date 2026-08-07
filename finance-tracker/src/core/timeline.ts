import type { Repositories, LedgerQuery } from '../db/repositories.js';
import type { EventType, LedgerEvent } from './types.js';
import { formatAmount, formatMagnitude } from './money.js';

/**
 * Presentation layer over the ledger.
 *
 * The ledger stores facts; this turns them into the sentences a person
 * actually wants to read, and groups the events belonging to one purchase
 * into a single thread so a coffee that was authorized, re-authorized and
 * finally settled with a tip reads as one story rather than three rows.
 */

export interface TimelineEntry {
  id: number;
  at: string;
  type: EventType;
  accountId: string | null;
  accountName: string | null;
  lifecycleId: string | null;
  transactionId: string | null;
  headline: string;
  detail: string | null;
  amount: number | null;
  amountDelta: number | null;
  currency: string;
  pending: boolean | null;
  /** True when this change is invisible in the bank's own history. */
  ephemeral: boolean;
  metadata: Record<string, unknown> | null;
}

/**
 * Changes a bank's transaction list will never show you: a pending charge
 * that vanished, and the gap between an authorized and a settled amount.
 */
const EPHEMERAL_TYPES = new Set<EventType>(['transaction.vanished']);

/**
 * True when the change leaves no trace in the bank's own history — the
 * evidence for it exists only because we were watching when it happened.
 */
function isEphemeral(event: LedgerEvent): boolean {
  if (EPHEMERAL_TYPES.has(event.type)) return true;
  // A settlement that moved the amount: the bank shows only the final figure.
  if (event.type === 'transaction.posted') return Boolean(event.amountDelta);
  // A pending charge amended while still pending — the amended state is
  // overwritten the moment it settles.
  if (event.type === 'transaction.changed') return event.pending === true && Boolean(event.amountDelta);
  return false;
}

function describeAmountDelta(event: LedgerEvent): string | null {
  if (event.amountDelta === null || event.amountDelta === 0) return null;
  const currency = event.currency ?? 'USD';
  // Amounts are negative for outflows, so a more-negative delta means the
  // charge grew. Phrase it in plain language rather than signed arithmetic.
  const grew = (event.amount ?? 0) < 0 ? event.amountDelta < 0 : event.amountDelta > 0;
  const magnitude = formatMagnitude(event.amountDelta, currency);
  return grew ? `increased by ${magnitude}` : `decreased by ${magnitude}`;
}

export function headlineFor(event: LedgerEvent, accountName: string | null): string {
  const currency = event.currency ?? 'USD';
  const who = event.description ?? 'Transaction';
  const amount = event.amount === null ? '' : formatMagnitude(event.amount, currency);
  const where = accountName ? ` · ${accountName}` : '';

  switch (event.type) {
    case 'transaction.added':
      return `${event.pending ? 'Pending' : 'New'} ${amount} at ${who}${where}`;
    case 'transaction.posted': {
      const delta = describeAmountDelta(event);
      return delta ? `Posted ${amount} at ${who} — ${delta}${where}` : `Posted ${amount} at ${who}${where}`;
    }
    case 'transaction.changed': {
      const delta = describeAmountDelta(event);
      return delta ? `${who} ${delta} to ${amount}${where}` : `${who} updated${where}`;
    }
    case 'transaction.vanished':
      return `Pending ${amount} at ${who} disappeared without posting${where}`;
    case 'transaction.removed':
      return `${amount} at ${who} was withdrawn by the bank${where}`;
    case 'balance.changed': {
      const delta = event.amountDelta === null ? null : formatAmount(event.amountDelta, currency, { signed: true });
      const now = formatAmount(event.amount ?? 0, currency);
      return `${accountName ?? 'Balance'} now ${now}${delta ? ` (${delta})` : ''}`;
    }
    case 'account.added':
      return event.description ?? 'Started tracking an account';
    case 'sync.error':
      return event.description ?? 'Sync failed';
    default:
      return who;
  }
}

function detailFor(event: LedgerEvent): string | null {
  if (event.type === 'transaction.posted') {
    const meta = event.metadata ?? {};
    const pendingAmount = typeof meta.pendingAmount === 'number' ? meta.pendingAmount : null;
    const postedAmount = typeof meta.postedAmount === 'number' ? meta.postedAmount : null;
    if (pendingAmount !== null && postedAmount !== null && pendingAmount !== postedAmount) {
      const currency = event.currency ?? 'USD';
      const how = meta.settlement === 'fuzzy' ? ' (matched heuristically)' : '';
      return `Authorized ${formatMagnitude(pendingAmount, currency)}, settled ${formatMagnitude(postedAmount, currency)}${how}`;
    }
    return null;
  }

  if (event.type === 'transaction.changed' && event.changes?.length) {
    return event.changes
      .filter((c) => c.field !== 'amount')
      .map((c) => `${c.field}: ${String(c.before ?? '—')} → ${String(c.after ?? '—')}`)
      .join('; ') || null;
  }

  if (event.type === 'transaction.vanished') {
    const at = event.metadata?.disappearedAt;
    return typeof at === 'string' ? `Left the account's pending list at ${at}; never appeared as a posted transaction` : null;
  }

  if (event.type === 'sync.error') {
    const err = event.metadata?.error;
    return typeof err === 'string' ? err : null;
  }

  return null;
}

export class TimelineService {
  constructor(private readonly repos: Repositories) {}

  private accountNames(): Map<string, string> {
    return new Map(this.repos.accounts.list().map((a) => [a.account_id, a.mask ? `${a.name} ••${a.mask}` : a.name]));
  }

  /** The chronological change history. Newest first by default. */
  list(query: LedgerQuery = {}): TimelineEntry[] {
    const names = this.accountNames();
    return this.repos.ledger.query(query).map((event) => this.toEntry(event, names));
  }

  private toEntry(event: LedgerEvent, names: Map<string, string>): TimelineEntry {
    const accountName = event.accountId ? (names.get(event.accountId) ?? null) : null;
    return {
      id: event.id,
      at: event.observedAt,
      type: event.type,
      accountId: event.accountId,
      accountName,
      lifecycleId: event.lifecycleId,
      transactionId: event.transactionId,
      headline: headlineFor(event, accountName),
      detail: detailFor(event),
      amount: event.amount,
      amountDelta: event.amountDelta,
      currency: event.currency ?? 'USD',
      pending: event.pending,
      ephemeral: isEphemeral(event),
      metadata: event.metadata,
    };
  }

  /** Every event belonging to one purchase, oldest first. */
  lifecycle(lifecycleId: string): {
    lifecycleId: string;
    events: TimelineEntry[];
    records: ReturnType<Repositories['transactions']['listByLifecycle']>;
  } {
    const names = this.accountNames();
    const events = this.repos.ledger
      .query({ lifecycleId, order: 'asc', limit: 1000 })
      .map((e) => this.toEntry(e, names));
    return { lifecycleId, events, records: this.repos.transactions.listByLifecycle(lifecycleId) };
  }

  /**
   * Pending charges that have left the feed but are not yet resolved. They
   * are neither in the bank's history nor (yet) in the ledger, so surfacing
   * them separately keeps the "nothing is invisible" promise while the grace
   * period runs.
   */
  unresolved(accountId?: string): Array<{
    transactionId: string;
    accountId: string;
    description: string;
    amount: number;
    currency: string;
    disappearedAt: string;
  }> {
    return this.repos.limbo.listOpen(accountId).map((row) => ({
      transactionId: row.transaction_id,
      accountId: row.account_id,
      description: row.merchant_name ?? row.name,
      amount: row.amount,
      currency: row.currency,
      disappearedAt: row.removed_at,
    }));
  }

  summary(since?: string): {
    counts: Record<string, number>;
    unresolvedPending: number;
    accounts: number;
  } {
    return {
      counts: this.repos.ledger.countByType(since),
      unresolvedPending: this.repos.limbo.listOpen().length,
      accounts: this.repos.accounts.list().length,
    };
  }
}
