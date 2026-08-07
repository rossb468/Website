import type { CanonicalTransaction, FieldChange } from './types.js';

/**
 * Fields we watch for changes, in the order they should be presented.
 *
 * Aggregators tell you *that* a transaction was modified but not *what*
 * changed, so the only way to answer "the amount went up by $9.30 because a
 * tip was added" is to keep the previous state and diff it ourselves.
 */
const TRACKED_FIELDS = [
  'amount',
  'pending',
  'date',
  'authorizedDate',
  'name',
  'merchantName',
  'category',
  'categoryDetailed',
  'paymentChannel',
  'currency',
] as const satisfies readonly (keyof CanonicalTransaction)[];

export type TrackedField = (typeof TRACKED_FIELDS)[number];

/** Fields whose movement is worth telling a human about. */
const SIGNIFICANT_FIELDS = new Set<string>(['amount', 'pending', 'date', 'merchantName', 'name']);

/**
 * Compare two observed states of the same transaction.
 *
 * Returns one entry per changed field, empty when nothing moved. `raw` is
 * excluded deliberately: providers reshuffle enrichment blobs constantly and
 * diffing them would produce endless noise.
 */
export function diffTransactions(before: CanonicalTransaction, after: CanonicalTransaction): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of TRACKED_FIELDS) {
    const a = before[field] ?? null;
    const b = after[field] ?? null;
    if (a !== b) {
      changes.push({ field, before: a, after: b });
    }
  }
  return changes;
}

export function hasSignificantChange(changes: FieldChange[]): boolean {
  return changes.some((c) => SIGNIFICANT_FIELDS.has(c.field));
}

export function findChange(changes: FieldChange[], field: TrackedField): FieldChange | undefined {
  return changes.find((c) => c.field === field);
}

/** Amount movement implied by a change list, in minor units. */
export function amountDelta(changes: FieldChange[]): number | null {
  const change = findChange(changes, 'amount');
  if (!change) return null;
  const before = typeof change.before === 'number' ? change.before : 0;
  const after = typeof change.after === 'number' ? change.after : 0;
  return after - before;
}

/** Turn a change list into a short human phrase for a notification body. */
export function describeChanges(changes: FieldChange[]): string {
  return changes
    .map((c) => {
      switch (c.field) {
        case 'pending':
          return c.after === false ? 'posted' : 'became pending';
        case 'amount':
          return 'amount changed';
        case 'date':
          return 'date changed';
        case 'merchantName':
        case 'name':
          return 'description updated';
        case 'category':
        case 'categoryDetailed':
          return 'recategorized';
        default:
          return `${c.field} changed`;
      }
    })
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(', ');
}
