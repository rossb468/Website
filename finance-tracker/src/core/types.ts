/**
 * Canonical domain types.
 *
 * Everything downstream of the provider adapters speaks these types, never
 * Plaid's. That is what makes the data source swappable: to move to Teller,
 * SimpleFIN, MX or a direct bank feed you write one adapter that emits
 * `CanonicalTransaction` and nothing else in the system changes.
 */

/** A transaction as it exists at one moment in time, provider-agnostic. */
export interface CanonicalTransaction {
  /** Provider's stable id for this transaction record. */
  transactionId: string;
  accountId: string;
  /**
   * Signed minor units (cents), normalized so that **negative = money leaves
   * the account** and positive = money arrives. Plaid uses the opposite sign
   * convention and floating-point major units; both are corrected at the
   * adapter boundary. Integer cents avoid float drift when diffing amounts,
   * which matters because a 1-cent difference is a real change we must catch.
   */
  amount: number;
  currency: string;
  /** Posted date for settled transactions, occurrence date while pending. */
  date: string;
  /** When the bank authorized it, if known. Often more meaningful than `date`. */
  authorizedDate: string | null;
  /** Raw description from the institution. */
  name: string;
  merchantName: string | null;
  pending: boolean;
  /**
   * When a pending transaction settles, providers generally issue a *new*
   * record and delete the pending one. This points back at the pending
   * record's id and is the thread we use to stitch the two halves into one
   * lifecycle.
   */
  pendingTransactionId: string | null;
  category: string | null;
  categoryDetailed: string | null;
  paymentChannel: string | null;
  logoUrl: string | null;
  website: string | null;
  /** Untouched provider payload, kept for debugging and future backfills. */
  raw: unknown;
}

export interface CanonicalAccount {
  accountId: string;
  itemId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  /** Minor units. Null when the institution does not report it. */
  currentBalance: number | null;
  availableBalance: number | null;
  creditLimit: number | null;
  currency: string;
}

/** One page of provider changes since a cursor. */
export interface SyncPage {
  added: CanonicalTransaction[];
  modified: CanonicalTransaction[];
  /** Provider only tells us the id — the record itself is already gone. */
  removed: string[];
  accounts: CanonicalAccount[];
  nextCursor: string;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Change ledger
// ---------------------------------------------------------------------------

/**
 * Every kind of change we record. The ledger is append-only and ordered, so
 * this enum is effectively the user-visible vocabulary of "what happened".
 */
export const EVENT_TYPES = [
  /** A transaction we have never seen before showed up (pending or posted). */
  'transaction.added',
  /** A field changed on a transaction that kept its identity. */
  'transaction.changed',
  /**
   * A pending transaction settled. Carries the amount delta, so this is the
   * event that surfaces "tip added" and "hold released".
   */
  'transaction.posted',
  /**
   * A pending transaction disappeared without ever settling — a dropped auth
   * hold, a reversed charge, a merchant retry. This is the class of change
   * that leaves no trace at all in a bank's transaction history.
   */
  'transaction.vanished',
  /**
   * The provider withdrew a *posted* transaction. Rare, and usually means the
   * institution restated history.
   */
  'transaction.removed',
  /** Account balance moved. */
  'balance.changed',
  /** A new account started being tracked. */
  'account.added',
  /** A sync attempt failed. Recorded so gaps in the ledger are explainable. */
  'sync.error',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** A single field-level change within a `transaction.changed` event. */
export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface LedgerEvent {
  id: number;
  /** When we detected it. The ledger is ordered by this. */
  observedAt: string;
  type: EventType;
  itemId: string | null;
  accountId: string | null;
  transactionId: string | null;
  /**
   * Groups every event belonging to one real-world purchase, surviving the
   * id change at posting time. Lets the UI show a single collapsible thread
   * per purchase rather than disconnected rows.
   */
  lifecycleId: string | null;
  /** Signed minor units at the time of the event, when meaningful. */
  amount: number | null;
  /** Change in amount this event represents, if any. */
  amountDelta: number | null;
  currency: string | null;
  description: string | null;
  pending: boolean | null;
  changes: FieldChange[] | null;
  /** Free-form extras: match confidence, error details, balances, etc. */
  metadata: Record<string, unknown> | null;
  /** Which sync pass produced this event. */
  syncRunId: number | null;
}

export type NewLedgerEvent = Omit<LedgerEvent, 'id' | 'observedAt'> & {
  observedAt?: string;
};
