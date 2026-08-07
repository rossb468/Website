import { describe, it, expect } from 'vitest';
import { diffTransactions, amountDelta, hasSignificantChange, describeChanges } from '../src/core/diff.js';
import {
  amountPlausibility,
  datePlausibility,
  describeSimilarity,
  findBestMatch,
  normalizeDescription,
  scoreMatch,
} from '../src/core/matcher.js';
import { formatAmount, formatMagnitude, toMinorUnits, toMajorUnits, minorUnitExponent } from '../src/core/money.js';
import type { CanonicalTransaction } from '../src/core/types.js';

function tx(overrides: Partial<CanonicalTransaction> = {}): CanonicalTransaction {
  return {
    transactionId: 't1',
    accountId: 'a1',
    amount: -1_000,
    currency: 'USD',
    date: '2026-03-10',
    authorizedDate: '2026-03-10',
    name: 'TEST MERCHANT',
    merchantName: 'Test Merchant',
    pending: true,
    pendingTransactionId: null,
    category: null,
    categoryDetailed: null,
    paymentChannel: 'in store',
    logoUrl: null,
    website: null,
    raw: null,
    ...overrides,
  };
}

describe('money', () => {
  it('converts major units to integer minor units without float drift', () => {
    // The case that breaks naive float arithmetic.
    expect(toMinorUnits(19.99, 'USD')).toBe(1_999);
    expect(toMinorUnits(0.1 + 0.2, 'USD')).toBe(30);
    expect(toMinorUnits(1234.56, 'USD')).toBe(123_456);
  });

  it('respects currencies whose minor unit is not 1/100', () => {
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(toMinorUnits(1500, 'JPY')).toBe(1_500);
    expect(minorUnitExponent('KWD')).toBe(3);
    expect(toMinorUnits(1.234, 'KWD')).toBe(1_234);
  });

  it('round-trips', () => {
    expect(toMajorUnits(toMinorUnits(42.37, 'USD'), 'USD')).toBeCloseTo(42.37, 5);
  });

  it('formats amounts and magnitudes', () => {
    expect(formatMagnitude(-7_130, 'USD')).toBe('$71.30');
    expect(formatAmount(-2_550, 'USD', { signed: true })).toBe('-$25.50');
    expect(formatAmount(2_550, 'USD', { signed: true })).toBe('+$25.50');
  });

  it('falls back gracefully for unofficial currency codes', () => {
    expect(formatMagnitude(150_000_000, 'BTC')).toContain('BTC');
  });
});

describe('diff', () => {
  it('detects a one-cent change', () => {
    const changes = diffTransactions(tx({ amount: -1_000 }), tx({ amount: -1_001 }));
    expect(changes).toEqual([{ field: 'amount', before: -1_000, after: -1_001 }]);
    expect(amountDelta(changes)).toBe(-1);
  });

  it('reports every changed field', () => {
    const changes = diffTransactions(
      tx({ amount: -1_000, pending: true, merchantName: 'Old' }),
      tx({ amount: -1_200, pending: false, merchantName: 'New' }),
    );
    expect(changes.map((c) => c.field).sort()).toEqual(['amount', 'merchantName', 'pending']);
  });

  it('ignores the opaque provider payload', () => {
    // Providers reshuffle enrichment blobs constantly; diffing them would
    // generate endless noise.
    expect(diffTransactions(tx({ raw: { a: 1 } }), tx({ raw: { b: 2 } }))).toHaveLength(0);
  });

  it('returns nothing for identical states', () => {
    expect(diffTransactions(tx(), tx())).toHaveLength(0);
    expect(amountDelta([])).toBeNull();
  });

  it('classifies significance and describes changes in plain language', () => {
    expect(hasSignificantChange(diffTransactions(tx(), tx({ amount: -50 })))).toBe(true);
    expect(hasSignificantChange(diffTransactions(tx(), tx({ category: 'FOOD' })))).toBe(false);
    expect(describeChanges(diffTransactions(tx({ pending: true }), tx({ pending: false })))).toBe('posted');
  });
});

describe('matcher', () => {
  it('strips processor prefixes, store numbers and noise from descriptions', () => {
    expect(normalizeDescription('SQ *BLUE BOTTLE COFFEE #451 SAN FRANCISCO CA')).toEqual([
      'BLUE',
      'BOTTLE',
      'COFFEE',
      'SAN',
      'FRANCISCO',
      'CA',
    ]);
    expect(normalizeDescription(null)).toEqual([]);
  });

  it('scores description similarity', () => {
    expect(describeSimilarity('TARTINE MANUFACTORY', 'TARTINE MANUFACTORY')).toBe(1);
    expect(describeSimilarity('TST* TARTINE MANUF', 'TARTINE MANUF')).toBeGreaterThan(0.5);
    expect(describeSimilarity('BLUE BOTTLE', 'DELTA AIR LINES')).toBe(0);
  });

  it('treats a modest increase as a plausible tip', () => {
    expect(amountPlausibility(-6_200, -7_130).score).toBeGreaterThan(0.8);
  });

  it('treats a large decrease as a plausible released hold', () => {
    expect(amountPlausibility(-10_000, -4_287).score).toBeGreaterThan(0.4);
  });

  it('rejects a sign flip outright', () => {
    // A refund can never be the settlement of a charge.
    expect(amountPlausibility(-5_000, 5_000).score).toBe(0);
  });

  it('rejects settlements too far apart in time', () => {
    expect(datePlausibility('2026-03-01', '2026-03-02').score).toBe(1);
    expect(datePlausibility('2026-03-01', '2026-04-15').score).toBe(0);
  });

  it('refuses to match across accounts or currencies', () => {
    expect(scoreMatch(tx(), tx({ accountId: 'other' })).score).toBe(0);
    expect(scoreMatch(tx(), tx({ currency: 'EUR' })).score).toBe(0);
  });

  it('picks a clear winner and declines a tie', () => {
    const pending = tx({ amount: -6_200, name: 'TARTINE MANUFACTORY', date: '2026-03-10' });

    const clear = findBestMatch(pending, [
      tx({ transactionId: 'p1', amount: -7_130, name: 'TARTINE MANUFACTORY', date: '2026-03-11', pending: false }),
      tx({ transactionId: 'p2', amount: -45_000, name: 'DELTA AIR LINES', date: '2026-03-11', pending: false }),
    ]);
    expect(clear?.transaction.transactionId).toBe('p1');

    const tie = findBestMatch(pending, [
      tx({ transactionId: 'p1', amount: -6_200, name: 'TARTINE MANUFACTORY', date: '2026-03-11', pending: false }),
      tx({ transactionId: 'p2', amount: -6_200, name: 'TARTINE MANUFACTORY', date: '2026-03-11', pending: false }),
    ]);
    expect(tie).toBeUndefined();
  });

  it('returns nothing when no candidate clears the threshold', () => {
    expect(findBestMatch(tx({ amount: -500, name: 'BLUE BOTTLE' }), [
      tx({ transactionId: 'x', amount: -90_000, name: 'MORTGAGE PAYMENT', date: '2026-06-01', pending: false }),
    ])).toBeUndefined();
  });
});
