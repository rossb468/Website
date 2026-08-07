import { randomUUID } from 'node:crypto';
import type { CanonicalAccount, CanonicalTransaction, SyncPage } from '../core/types.js';
import type { FinancialDataProvider } from './types.js';
import { ProviderCursorInvalid } from './types.js';

/**
 * A simulated bank.
 *
 * This is not a stub that returns canned JSON — it reproduces the awkward
 * behaviour that makes the change ledger necessary in the first place:
 *
 *   - a pending charge settles as a *different* transaction id, linked only
 *     by `pendingTransactionId`;
 *   - the settled amount often differs from the authorized amount (a tip is
 *     added, a fuel hold is released);
 *   - some pending charges disappear and never settle at all;
 *   - posted transactions are sometimes restated days later.
 *
 * It records an append-only changelog exactly as a cursor-based aggregator
 * does, so the sync engine, differ and stitcher run against it unmodified.
 * That makes the entire pipeline developable and testable with no API keys.
 */

interface ChangeSet {
  added: CanonicalTransaction[];
  modified: CanonicalTransaction[];
  removed: string[];
}

export interface MockAuthorizeOptions {
  accountId?: string;
  amount: number;
  name: string;
  merchantName?: string | null;
  date?: string;
  category?: string | null;
  pending?: boolean;
}

const CURSOR_PREFIX = 'mock:';

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!cursor.startsWith(CURSOR_PREFIX)) throw new ProviderCursorInvalid(`Unrecognised cursor: ${cursor}`);
  const n = Number(cursor.slice(CURSOR_PREFIX.length));
  if (!Number.isInteger(n) || n < 0) throw new ProviderCursorInvalid(`Malformed cursor: ${cursor}`);
  return n;
}

export class MockProvider implements FinancialDataProvider {
  readonly name = 'mock';

  private readonly changelog: ChangeSet[] = [];
  private readonly current = new Map<string, CanonicalTransaction>();
  private readonly accounts = new Map<string, CanonicalAccount>();
  private seq = 0;

  constructor(
    readonly itemId = 'mock-item-1',
    /** Small page size keeps the engine's pagination loop under test. */
    private readonly pageSize = 100,
  ) {
    this.addAccount({
      accountId: 'mock-checking',
      itemId,
      name: 'Everyday Checking',
      officialName: 'Everyday Checking Account',
      mask: '4471',
      type: 'depository',
      subtype: 'checking',
      currentBalance: 482_355,
      availableBalance: 470_100,
      creditLimit: null,
      currency: 'USD',
    });
  }

  // -- bank operations ------------------------------------------------------

  addAccount(account: CanonicalAccount): void {
    this.accounts.set(account.accountId, account);
  }

  setBalance(accountId: string, current: number, available?: number): void {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error(`Unknown mock account: ${accountId}`);
    account.currentBalance = current;
    account.availableBalance = available ?? current;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private push(change: ChangeSet): void {
    this.changelog.push(change);
    this.seq += 1;
  }

  /** A card authorization: shows up as a pending charge. */
  authorize(opts: MockAuthorizeOptions): CanonicalTransaction {
    const accountId = opts.accountId ?? 'mock-checking';
    const tx: CanonicalTransaction = {
      transactionId: `mock-tx-${randomUUID().slice(0, 8)}`,
      accountId,
      amount: opts.amount,
      currency: 'USD',
      date: opts.date ?? this.today(),
      authorizedDate: opts.date ?? this.today(),
      name: opts.name,
      merchantName: opts.merchantName ?? opts.name,
      pending: opts.pending ?? true,
      pendingTransactionId: null,
      category: opts.category ?? null,
      categoryDetailed: null,
      paymentChannel: 'in store',
      logoUrl: null,
      website: null,
      raw: { simulated: true },
    };
    this.current.set(tx.transactionId, tx);
    this.push({ added: [tx], modified: [], removed: [] });
    return tx;
  }

  /** Amend a transaction in place, keeping its id. */
  modify(transactionId: string, patch: Partial<CanonicalTransaction>): CanonicalTransaction {
    const existing = this.current.get(transactionId);
    if (!existing) throw new Error(`Unknown mock transaction: ${transactionId}`);
    const updated = { ...existing, ...patch };
    this.current.set(transactionId, updated);
    this.push({ added: [], modified: [updated], removed: [] });
    return updated;
  }

  /**
   * Settle a pending charge. Mirrors the real behaviour: the pending record
   * is deleted and a brand-new posted record appears, linked back through
   * `pendingTransactionId`. `finalAmount` differing from the authorized
   * amount is how tips and hold releases show up.
   */
  settle(
    pendingId: string,
    opts: { finalAmount?: number; date?: string; linkPendingId?: boolean } = {},
  ): CanonicalTransaction {
    const pending = this.current.get(pendingId);
    if (!pending) throw new Error(`Unknown mock transaction: ${pendingId}`);

    const posted: CanonicalTransaction = {
      ...pending,
      transactionId: `mock-tx-${randomUUID().slice(0, 8)}`,
      amount: opts.finalAmount ?? pending.amount,
      date: opts.date ?? pending.date,
      pending: false,
      // Some institutions omit this link. `linkPendingId: false` simulates
      // that, which is what exercises the fuzzy matcher.
      pendingTransactionId: opts.linkPendingId === false ? null : pendingId,
    };

    this.current.delete(pendingId);
    this.current.set(posted.transactionId, posted);
    this.push({ added: [posted], modified: [], removed: [pendingId] });
    return posted;
  }

  /** A pending charge that evaporates — a dropped auth hold or reversal. */
  dropPending(pendingId: string): void {
    if (!this.current.delete(pendingId)) throw new Error(`Unknown mock transaction: ${pendingId}`);
    this.push({ added: [], modified: [], removed: [pendingId] });
  }

  /** The institution withdraws a posted transaction. */
  removePosted(transactionId: string): void {
    if (!this.current.delete(transactionId)) throw new Error(`Unknown mock transaction: ${transactionId}`);
    this.push({ added: [], modified: [], removed: [transactionId] });
  }

  // -- provider interface ---------------------------------------------------

  async syncPage(_accessToken: string, cursor: string | undefined): Promise<SyncPage> {
    const from = parseCursor(cursor);
    if (from > this.changelog.length) {
      throw new ProviderCursorInvalid(`Cursor ahead of changelog: ${cursor}`);
    }

    const to = Math.min(from + this.pageSize, this.changelog.length);
    const slice = this.changelog.slice(from, to);

    const added: CanonicalTransaction[] = [];
    const modified: CanonicalTransaction[] = [];
    const removed: string[] = [];
    for (const change of slice) {
      added.push(...change.added);
      modified.push(...change.modified);
      removed.push(...change.removed);
    }

    return {
      added,
      modified,
      removed,
      accounts: [...this.accounts.values()].map((a) => ({ ...a })),
      nextCursor: `${CURSOR_PREFIX}${to}`,
      hasMore: to < this.changelog.length,
    };
  }

  async refresh(): Promise<boolean> {
    return true;
  }

  async verifyWebhook(): Promise<boolean> {
    return true;
  }

  /** Test helper: how many change sets exist. */
  get generation(): number {
    return this.seq;
  }
}

/**
 * Populate a mock bank with a day of activity covering every lifecycle the
 * ledger is designed to capture. Used by `npm run cli -- demo`.
 */
export function seedDemoScenario(bank: MockProvider): {
  coffee: CanonicalTransaction;
  dinner: CanonicalTransaction;
  gas: CanonicalTransaction;
  hotel: CanonicalTransaction;
  subscription: CanonicalTransaction;
} {
  const coffee = bank.authorize({ amount: -545, name: 'BLUE BOTTLE COFFEE', category: 'FOOD_AND_DRINK' });
  const dinner = bank.authorize({ amount: -6_200, name: 'TARTINE MANUFACTORY', category: 'FOOD_AND_DRINK' });
  const gas = bank.authorize({ amount: -10_000, name: 'SHELL OIL 574', category: 'TRANSPORTATION' });
  const hotel = bank.authorize({ amount: -25_000, name: 'MARRIOTT UNION SQ', category: 'TRAVEL' });
  const subscription = bank.authorize({
    amount: -1_599,
    name: 'NETFLIX.COM',
    category: 'ENTERTAINMENT',
    pending: false,
  });
  return { coffee, dinner, gas, hotel, subscription };
}
