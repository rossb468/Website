import type { CanonicalTransaction } from './types.js';

/**
 * Fuzzy pending -> posted matching.
 *
 * The reliable path is `pendingTransactionId`, but a meaningful minority of
 * institutions never populate it. Without a fallback, every settled charge at
 * those banks would be reported as "pending vanished" plus "new transaction
 * appeared" — two misleading events instead of one accurate one, and the
 * amount delta that reveals a tip would be lost.
 *
 * So we score candidates on the three signals that survive settlement:
 * amount, date and description. Scoring is deliberately conservative; an
 * unmatched pending charge (reported as vanished, then later reconciled) is a
 * much less harmful error than wrongly welding together two real purchases.
 */

export interface MatchCandidate {
  transaction: CanonicalTransaction;
  score: number;
  reasons: string[];
}

/** Below this, we do not claim a match. */
export const MATCH_THRESHOLD = 0.62;

/** Payment-processor prefixes and trailing store/reference numbers add noise. */
const NOISE_TOKENS = new Set([
  'THE', 'AND', 'INC', 'LLC', 'LTD', 'CO', 'CORP', 'COMPANY',
  'POS', 'PURCHASE', 'PAYMENT', 'DEBIT', 'CREDIT', 'CARD', 'VISA', 'MASTERCARD',
  'PENDING', 'AUTH', 'TRANSACTION', 'STORE', 'US', 'USA',
  'SQ', 'TST', 'PAYPAL', 'PP', 'SP', 'IC',
]);

/**
 * Reduce a bank description to comparable tokens.
 * "SQ *BLUE BOTTLE COFFEE #451 SAN FRANCISCO CA" -> ["BLUE","BOTTLE","COFFEE"]
 */
export function normalizeDescription(input: string | null | undefined): string[] {
  if (!input) return [];
  return input
    .toUpperCase()
    .replace(/[*#]/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    // Drop pure numbers (store ids, reference numbers) and 1-char fragments.
    .filter((t) => !/^\d+$/.test(t) && t.length > 1)
    .filter((t) => !NOISE_TOKENS.has(t));
}

/** Jaccard similarity over normalized tokens, 0..1. */
export function describeSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = new Set(normalizeDescription(a));
  const tb = new Set(normalizeDescription(b));
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  for (const token of ta) if (tb.has(token)) intersection += 1;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));
  return Number.isNaN(ms) ? 99 : Math.round(ms / 86_400_000);
}

/**
 * Amount plausibility, 0..1.
 *
 * Settlement rarely lands on the authorized amount:
 *   - restaurants authorize the pre-tip total, settle 15-25% higher;
 *   - fuel pumps authorize a flat hold ($100 is common), settle much lower;
 *   - hotels authorize an incidentals buffer and release the remainder.
 *
 * Amounts are negative for outflows, so we compare magnitudes and treat an
 * increase (tip) and a large decrease (hold release) as separately plausible.
 */
export function amountPlausibility(pendingAmount: number, postedAmount: number): { score: number; reason: string } {
  // A sign flip means one is a refund and the other a charge — never a match.
  if (Math.sign(pendingAmount) !== Math.sign(postedAmount)) return { score: 0, reason: 'sign mismatch' };

  const pending = Math.abs(pendingAmount);
  const posted = Math.abs(postedAmount);
  if (pending === 0) return { score: 0, reason: 'zero pending amount' };

  if (pending === posted) return { score: 1, reason: 'exact amount' };

  const ratio = posted / pending;

  // Settled higher: tip or added service charge. Up to +30% is routine.
  if (ratio > 1) {
    if (ratio <= 1.3) return { score: 0.9, reason: `settled ${Math.round((ratio - 1) * 100)}% higher (tip)` };
    if (ratio <= 1.5) return { score: 0.6, reason: `settled ${Math.round((ratio - 1) * 100)}% higher` };
    return { score: 0.15, reason: 'settled implausibly higher' };
  }

  // Settled lower: partial capture or released hold.
  if (ratio >= 0.9) return { score: 0.85, reason: 'settled slightly lower' };
  if (ratio >= 0.5) return { score: 0.6, reason: 'settled lower (partial capture)' };
  if (ratio >= 0.1) return { score: 0.45, reason: 'settled much lower (released hold)' };
  return { score: 0.2, reason: 'settled far lower' };
}

/** Date proximity, 0..1. Settlement typically takes one to five business days. */
export function datePlausibility(pendingDate: string, postedDate: string): { score: number; reason: string } {
  const days = daysBetween(pendingDate, postedDate);
  if (days <= 1) return { score: 1, reason: 'same or next day' };
  if (days <= 3) return { score: 0.9, reason: `${days} days apart` };
  if (days <= 5) return { score: 0.75, reason: `${days} days apart` };
  if (days <= 10) return { score: 0.4, reason: `${days} days apart` };
  return { score: 0, reason: `${days} days apart (too far)` };
}

/**
 * Score one posted transaction against one vanished pending transaction.
 * Weighted so that no single signal can carry a match on its own.
 */
export function scoreMatch(pending: CanonicalTransaction, posted: CanonicalTransaction): MatchCandidate {
  const reasons: string[] = [];

  if (pending.accountId !== posted.accountId) {
    return { transaction: posted, score: 0, reasons: ['different account'] };
  }
  if (pending.currency !== posted.currency) {
    return { transaction: posted, score: 0, reasons: ['different currency'] };
  }

  const amount = amountPlausibility(pending.amount, posted.amount);
  const date = datePlausibility(pending.date, posted.date);
  const nameScore = Math.max(
    describeSimilarity(pending.name, posted.name),
    describeSimilarity(pending.merchantName, posted.merchantName),
    describeSimilarity(pending.merchantName, posted.name),
    describeSimilarity(pending.name, posted.merchantName),
  );

  reasons.push(amount.reason, date.reason);
  if (nameScore > 0) reasons.push(`description ${Math.round(nameScore * 100)}% similar`);

  // Any hard zero disqualifies outright.
  if (amount.score === 0 || date.score === 0) {
    return { transaction: posted, score: 0, reasons };
  }

  const score = amount.score * 0.45 + date.score * 0.25 + nameScore * 0.3;
  return { transaction: posted, score, reasons };
}

/**
 * Best candidate for a vanished pending transaction, or undefined.
 *
 * Requires a clear winner: if the runner-up is within 10% of the leader we
 * decline, because two similar charges at the same merchant on the same day
 * (a common real pattern) cannot be told apart on these signals alone.
 */
export function findBestMatch(
  pending: CanonicalTransaction,
  candidates: CanonicalTransaction[],
  threshold = MATCH_THRESHOLD,
): MatchCandidate | undefined {
  const scored = candidates
    .map((c) => scoreMatch(pending, c))
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return undefined;

  const runnerUp = scored[1];
  if (runnerUp && best.score - runnerUp.score < 0.1) {
    return undefined;
  }
  return best;
}
