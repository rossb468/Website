import { randomUUID } from 'node:crypto';
import type { Repositories } from '../db/repositories.js';
import { rowToCanonical, type SyncTrigger } from '../db/repositories.js';
import { transact } from '../db/index.js';
import type { CanonicalAccount, CanonicalTransaction, LedgerEvent, NewLedgerEvent, SyncPage } from './types.js';
import { amountDelta, diffTransactions } from './diff.js';
import { findBestMatch } from './matcher.js';
import { logger } from '../logger.js';
import { ProviderCursorInvalid, ProviderReauthRequired, type FinancialDataProvider } from '../providers/types.js';

export interface SyncOptions {
  itemId: string;
  accessToken: string;
  trigger: SyncTrigger;
  /** Grace period before an unmatched vanished pending is declared gone. */
  pendingLimboGraceHours: number;
  /** Safety valve so a runaway `has_more` cannot loop forever. */
  maxPages?: number;
}

export interface SyncResult {
  itemId: string;
  runId: number;
  ok: boolean;
  pages: number;
  added: number;
  modified: number;
  removed: number;
  events: LedgerEvent[];
  error?: string;
}

/**
 * Applies provider change feeds to local state and derives the change ledger.
 *
 * The ordering inside `applyPage` is deliberate and load-bearing:
 * removals are processed *before* additions so that when a pending charge and
 * its settled replacement arrive in the same page — the common case — the
 * pending record is already sitting in limbo and the new posted record can be
 * stitched onto it. Reverse the order and every settlement would be reported
 * as an unrelated disappearance plus an unrelated new charge.
 */
export class SyncEngine {
  constructor(
    private readonly repos: Repositories,
    private readonly provider: FinancialDataProvider,
  ) {}

  async syncItem(options: SyncOptions): Promise<SyncResult> {
    const { itemId, accessToken, trigger } = options;
    const runId = this.repos.runs.start(itemId, trigger);
    const events: LedgerEvent[] = [];
    let pages = 0;
    let added = 0;
    let modified = 0;
    let removed = 0;

    try {
      const item = this.repos.items.get(itemId);
      let cursor = item?.cursor ?? undefined;
      const maxPages = options.maxPages ?? 50;
      let hasMore = true;
      let restarted = false;

      while (hasMore && pages < maxPages) {
        let page: SyncPage;
        try {
          page = await this.provider.syncPage(accessToken, cursor);
        } catch (err) {
          if (err instanceof ProviderCursorInvalid && !restarted) {
            // The provider dropped our cursor. Replaying from scratch is
            // safe: every replayed transaction diffs clean against stored
            // state, so no duplicate events are produced.
            logger.warn({ itemId }, 'cursor rejected; restarting sync from the beginning');
            restarted = true;
            cursor = undefined;
            continue;
          }
          throw err;
        }

        pages += 1;
        added += page.added.length;
        modified += page.modified.length;
        removed += page.removed.length;

        // One transaction per page: the cursor only advances if every event
        // derived from that page was durably written. A crash mid-page means
        // the page is replayed, not skipped.
        const pageEvents = transact(this.repos.db, () => {
          const produced = this.applyPage(page, itemId, runId, options.pendingLimboGraceHours);
          this.repos.items.setCursor(itemId, page.nextCursor);
          return produced;
        });

        events.push(...pageEvents);
        cursor = page.nextCursor;
        hasMore = page.hasMore;
      }

      if (hasMore) {
        logger.warn({ itemId, pages }, 'stopped paginating at maxPages; will continue on next sync');
      }

      // Resolve anything whose grace period lapsed while we were away.
      const swept = transact(this.repos.db, () =>
        this.sweepExpiredLimbo(itemId, runId, options.pendingLimboGraceHours),
      );
      events.push(...swept);

      this.repos.items.markSyncOk(itemId);
      this.repos.runs.finish(runId, { ok: true, added, modified, removed, events: events.length, pages });

      return { itemId, runId, ok: true, pages, added, modified, removed, events };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const needsReauth = err instanceof ProviderReauthRequired;
      this.repos.items.markSyncError(itemId, message, needsReauth);
      this.repos.runs.finish(runId, { ok: false, added, modified, removed, events: events.length, pages, error: message });

      // Record the failure so gaps in the ledger are explainable rather than
      // looking like a period of no account activity.
      const errorEvent = this.repos.ledger.append({
        type: 'sync.error',
        itemId,
        accountId: null,
        transactionId: null,
        lifecycleId: null,
        amount: null,
        amountDelta: null,
        currency: null,
        description: needsReauth ? 'Connection needs re-authentication' : 'Sync failed',
        pending: null,
        changes: null,
        metadata: { error: message, needsReauth, trigger },
        syncRunId: runId,
      });
      events.push(errorEvent);

      logger.error({ itemId, err: message }, 'sync failed');
      return { itemId, runId, ok: false, pages, added, modified, removed, events, error: message };
    }
  }

  // -- page application -----------------------------------------------------

  private applyPage(page: SyncPage, itemId: string, runId: number, graceHours: number): LedgerEvent[] {
    const events: LedgerEvent[] = [];

    events.push(...this.applyAccounts(page.accounts, itemId, runId));
    // Order matters — see the class comment.
    events.push(...this.applyRemovals(page.removed, itemId, runId));
    events.push(...this.applyAdditions(page.added, itemId, runId));
    events.push(...this.applyModifications(page.modified, itemId, runId));

    // A settlement that landed in this very page can resolve a limbo entry
    // created moments ago, so only sweep what is genuinely expired.
    events.push(...this.sweepExpiredLimbo(itemId, runId, graceHours));

    return events;
  }

  private applyAccounts(accounts: CanonicalAccount[], itemId: string, runId: number): LedgerEvent[] {
    const events: LedgerEvent[] = [];

    for (const account of accounts) {
      const scoped: CanonicalAccount = { ...account, itemId };
      const { existed, previous } = this.repos.accounts.upsert(scoped);

      if (!existed) {
        events.push(
          this.append({
            type: 'account.added',
            itemId,
            accountId: account.accountId,
            transactionId: null,
            lifecycleId: null,
            amount: account.currentBalance,
            amountDelta: null,
            currency: account.currency,
            description: `Tracking ${account.name}${account.mask ? ` ••${account.mask}` : ''}`,
            pending: null,
            changes: null,
            metadata: { type: account.type, subtype: account.subtype },
            syncRunId: runId,
          }),
        );
        continue;
      }

      const before = previous?.current_balance ?? null;
      const after = account.currentBalance;
      if (before !== null && after !== null && before !== after) {
        events.push(
          this.append({
            type: 'balance.changed',
            itemId,
            accountId: account.accountId,
            transactionId: null,
            lifecycleId: null,
            amount: after,
            amountDelta: after - before,
            currency: account.currency,
            description: `Balance changed on ${account.name}`,
            pending: null,
            changes: [
              { field: 'currentBalance', before, after },
              ...(previous?.available_balance !== account.availableBalance
                ? [
                    {
                      field: 'availableBalance',
                      before: previous?.available_balance ?? null,
                      after: account.availableBalance,
                    },
                  ]
                : []),
            ],
            metadata: null,
            syncRunId: runId,
          }),
        );
      }
    }
    return events;
  }

  /**
   * A removal is ambiguous at the moment it arrives: a pending charge that
   * disappears has either settled (its replacement may not have been
   * delivered yet) or evaporated. We therefore park pending removals in limbo
   * and emit nothing; posted removals are unambiguous and reported at once.
   */
  private applyRemovals(removedIds: string[], itemId: string, runId: number): LedgerEvent[] {
    const events: LedgerEvent[] = [];

    for (const transactionId of removedIds) {
      const row = this.repos.transactions.get(transactionId);
      if (!row) continue;
      // Already stitched onto its settled replacement, or already handled.
      if (row.state === 'superseded' || row.state === 'removed' || row.state === 'vanished') continue;

      const tx = rowToCanonical(row);

      if (row.pending === 1) {
        this.repos.limbo.add(tx, itemId, row.lifecycle_id);
        this.repos.transactions.setState(transactionId, 'removed');
        logger.debug({ transactionId, amount: tx.amount }, 'pending transaction left the feed; awaiting resolution');
        continue;
      }

      this.repos.transactions.setState(transactionId, 'removed');
      events.push(
        this.append({
          type: 'transaction.removed',
          itemId,
          accountId: tx.accountId,
          transactionId,
          lifecycleId: row.lifecycle_id,
          amount: tx.amount,
          amountDelta: null,
          currency: tx.currency,
          description: tx.merchantName ?? tx.name,
          pending: false,
          changes: null,
          metadata: { reason: 'withdrawn by institution' },
          syncRunId: runId,
        }),
      );
    }
    return events;
  }

  private applyAdditions(additions: CanonicalTransaction[], itemId: string, runId: number): LedgerEvent[] {
    const events: LedgerEvent[] = [];

    for (const tx of additions) {
      const existing = this.repos.transactions.get(tx.transactionId);
      if (existing) {
        // Cursor replay, or a provider re-announcing a known transaction.
        // Diff it rather than inserting a duplicate.
        const event = this.applyUpdate(rowToCanonical(existing), tx, existing.lifecycle_id, itemId, runId);
        if (event) events.push(event);
        continue;
      }

      const settlement = this.findSettledPending(tx);
      if (settlement) {
        events.push(this.recordSettlement(tx, settlement, itemId, runId));
        continue;
      }

      const lifecycleId = randomUUID();
      this.repos.transactions.insert(tx, itemId, lifecycleId);
      this.repos.transactions.addVersion(tx, lifecycleId);

      events.push(
        this.append({
          type: 'transaction.added',
          itemId,
          accountId: tx.accountId,
          transactionId: tx.transactionId,
          lifecycleId,
          amount: tx.amount,
          amountDelta: null,
          currency: tx.currency,
          description: tx.merchantName ?? tx.name,
          pending: tx.pending,
          changes: null,
          metadata: { category: tx.category, date: tx.date, name: tx.name },
          syncRunId: runId,
        }),
      );
    }
    return events;
  }

  private applyModifications(modifications: CanonicalTransaction[], itemId: string, runId: number): LedgerEvent[] {
    const events: LedgerEvent[] = [];

    for (const tx of modifications) {
      const existing = this.repos.transactions.get(tx.transactionId);
      if (!existing) {
        // Modified before we ever saw it added — treat it as an addition so
        // the transaction is not lost.
        events.push(...this.applyAdditions([tx], itemId, runId));
        continue;
      }
      const event = this.applyUpdate(rowToCanonical(existing), tx, existing.lifecycle_id, itemId, runId);
      if (event) events.push(event);
    }
    return events;
  }

  /** Diff one transaction against its stored state and record the delta. */
  private applyUpdate(
    before: CanonicalTransaction,
    after: CanonicalTransaction,
    lifecycleId: string,
    itemId: string,
    runId: number,
  ): LedgerEvent | undefined {
    const changes = diffTransactions(before, after);
    if (changes.length === 0) {
      this.repos.transactions.touch(after.transactionId);
      return undefined;
    }

    this.repos.transactions.update(after);
    this.repos.transactions.addVersion(after, lifecycleId);

    const delta = amountDelta(changes);
    // A few institutions settle in place, flipping `pending` on the same
    // transaction id instead of issuing a new record. That is still a
    // posting, and deserves the posting event rather than a generic change.
    const settledInPlace = before.pending && !after.pending;

    return this.append({
      type: settledInPlace ? 'transaction.posted' : 'transaction.changed',
      itemId,
      accountId: after.accountId,
      transactionId: after.transactionId,
      lifecycleId,
      amount: after.amount,
      amountDelta: delta,
      currency: after.currency,
      description: after.merchantName ?? after.name,
      pending: after.pending,
      changes,
      metadata: settledInPlace ? { settlement: 'in_place' } : null,
      syncRunId: runId,
    });
  }

  // -- pending lifecycle ----------------------------------------------------

  /**
   * Decide whether a newly-added transaction is the settled form of a pending
   * charge we already know about.
   *
   * Two routes: the provider's explicit `pendingTransactionId` link, which is
   * authoritative when present, and a scored fuzzy match against pending
   * charges that recently left the feed, for institutions that omit the link.
   */
  private findSettledPending(
    tx: CanonicalTransaction,
  ): { pending: CanonicalTransaction; lifecycleId: string; method: 'linked' | 'fuzzy'; confidence: number; reasons: string[] } | undefined {
    if (tx.pending) return undefined;

    if (tx.pendingTransactionId) {
      const limboRow = this.repos.limbo.get(tx.pendingTransactionId);
      if (limboRow && limboRow.resolution === null) {
        return {
          pending: this.repos.limbo.snapshotOf(limboRow),
          lifecycleId: limboRow.lifecycle_id,
          method: 'linked',
          confidence: 1,
          reasons: ['provider supplied pendingTransactionId'],
        };
      }
      // Some providers announce the posted record before withdrawing the
      // pending one, so the pending may still be live in `transactions`.
      const stored = this.repos.transactions.get(tx.pendingTransactionId);
      if (stored && stored.state !== 'superseded') {
        return {
          pending: rowToCanonical(stored),
          lifecycleId: stored.lifecycle_id,
          method: 'linked',
          confidence: 1,
          reasons: ['provider supplied pendingTransactionId'],
        };
      }
      return undefined;
    }

    // No link supplied — fall back to scoring against open limbo entries.
    const open = this.repos.limbo.listOpen(tx.accountId);
    if (open.length === 0) return undefined;

    const candidates = open.map((row) => ({ row, snapshot: this.repos.limbo.snapshotOf(row) }));
    // findBestMatch scores posted-against-pending, so invert the call: score
    // each pending candidate against this posted transaction and take the best.
    const scored = candidates
      .map(({ row, snapshot }) => ({ row, snapshot, match: findBestMatch(snapshot, [tx]) }))
      .filter((c): c is typeof c & { match: NonNullable<typeof c.match> } => c.match !== undefined)
      .sort((a, b) => b.match.score - a.match.score);

    const best = scored[0];
    if (!best) return undefined;

    // Ambiguous between two pending charges — decline rather than guess.
    const runnerUp = scored[1];
    if (runnerUp && best.match.score - runnerUp.match.score < 0.1) {
      logger.debug({ transactionId: tx.transactionId }, 'declining ambiguous fuzzy settlement match');
      return undefined;
    }

    return {
      pending: best.snapshot,
      lifecycleId: best.row.lifecycle_id,
      method: 'fuzzy',
      confidence: best.match.score,
      reasons: best.match.reasons,
    };
  }

  /**
   * Record a settlement: the posted record joins the pending charge's
   * lifecycle, and the amount delta between them is what surfaces an added
   * tip or a released hold.
   */
  private recordSettlement(
    posted: CanonicalTransaction,
    settlement: { pending: CanonicalTransaction; lifecycleId: string; method: 'linked' | 'fuzzy'; confidence: number; reasons: string[] },
    itemId: string,
    runId: number,
  ): LedgerEvent {
    const { pending, lifecycleId } = settlement;

    this.repos.transactions.insert(posted, itemId, lifecycleId);
    this.repos.transactions.addVersion(posted, lifecycleId);
    this.repos.transactions.setState(pending.transactionId, 'superseded');
    if (this.repos.limbo.get(pending.transactionId)) {
      this.repos.limbo.resolve(pending.transactionId, 'posted', posted.transactionId);
    }

    const delta = posted.amount - pending.amount;
    const changes = diffTransactions(pending, posted).filter((c) => c.field !== 'pending');

    return this.append({
      type: 'transaction.posted',
      itemId,
      accountId: posted.accountId,
      transactionId: posted.transactionId,
      lifecycleId,
      amount: posted.amount,
      amountDelta: delta,
      currency: posted.currency,
      description: posted.merchantName ?? posted.name,
      pending: false,
      changes: changes.length ? changes : null,
      metadata: {
        settlement: settlement.method,
        matchConfidence: Number(settlement.confidence.toFixed(3)),
        matchReasons: settlement.reasons,
        pendingTransactionId: pending.transactionId,
        pendingAmount: pending.amount,
        postedAmount: posted.amount,
        // Named so the UI can label the event without re-deriving the sign.
        amountIncreased: Math.abs(posted.amount) > Math.abs(pending.amount),
      },
      syncRunId: runId,
    });
  }

  /**
   * Pending charges that left the feed, never settled, and have now waited
   * out the grace period. These are the changes that leave no trace at all in
   * a bank's own history — the charge existed, moved the available balance,
   * and then simply stopped existing.
   */
  private sweepExpiredLimbo(itemId: string, runId: number, graceHours: number): LedgerEvent[] {
    const events: LedgerEvent[] = [];

    for (const row of this.repos.limbo.listExpired(graceHours)) {
      if (row.item_id !== itemId) continue;

      const tx = this.repos.limbo.snapshotOf(row);
      this.repos.limbo.resolve(row.transaction_id, 'vanished');
      this.repos.transactions.setState(row.transaction_id, 'vanished');

      events.push(
        this.append({
          type: 'transaction.vanished',
          itemId,
          accountId: row.account_id,
          transactionId: row.transaction_id,
          lifecycleId: row.lifecycle_id,
          amount: tx.amount,
          amountDelta: -tx.amount,
          currency: tx.currency,
          description: tx.merchantName ?? tx.name,
          pending: true,
          changes: null,
          metadata: {
            disappearedAt: row.removed_at,
            graceHours,
            reason: 'pending charge never settled',
          },
          syncRunId: runId,
          // Dated to when the charge actually left the account, not when the
          // grace period lapsed, so the timeline reads in true order.
          observedAt: row.removed_at,
        }),
      );
    }
    return events;
  }

  private append(event: NewLedgerEvent): LedgerEvent {
    return this.repos.ledger.append(event);
  }
}
