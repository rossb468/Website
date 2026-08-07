import type { Config } from '../config.js';
import type { Repositories, SyncTrigger } from '../db/repositories.js';
import { logger } from '../logger.js';
import type { NotificationDispatcher } from '../notify/dispatcher.js';
import type { FinancialDataProvider } from '../providers/types.js';
import { SyncEngine, type SyncResult } from './sync.js';

/**
 * Ties syncing to notifying, and keeps concurrent passes from colliding.
 *
 * A poll tick and an inbound webhook routinely land at the same moment. Two
 * concurrent syncs of one item would both read the same cursor, both fetch
 * the same page and both try to write the same events — so passes are
 * serialised per item, and a request arriving while a sync is in flight joins
 * the running one instead of starting a second.
 */
export class Orchestrator {
  private readonly engine: SyncEngine;
  private readonly inFlight = new Map<string, Promise<SyncResult>>();

  constructor(
    private readonly config: Config,
    private readonly repos: Repositories,
    private readonly provider: FinancialDataProvider,
    private readonly dispatcher: NotificationDispatcher,
  ) {
    this.engine = new SyncEngine(repos, provider);
  }

  /** Sync one item and push notifications for whatever it turned up. */
  async syncItem(itemId: string, trigger: SyncTrigger): Promise<SyncResult> {
    const existing = this.inFlight.get(itemId);
    if (existing) {
      logger.debug({ itemId, trigger }, 'sync already running; joining in-flight pass');
      return existing;
    }

    const run = this.runSync(itemId, trigger).finally(() => this.inFlight.delete(itemId));
    this.inFlight.set(itemId, run);
    return run;
  }

  private async runSync(itemId: string, trigger: SyncTrigger): Promise<SyncResult> {
    const item = this.repos.items.get(itemId);
    if (!item) throw new Error(`Unknown item: ${itemId}`);
    if (item.status === 'disabled') {
      logger.debug({ itemId }, 'item disabled; skipping sync');
      return { itemId, runId: -1, ok: true, pages: 0, added: 0, modified: 0, removed: 0, events: [] };
    }

    await this.maybeRefresh(itemId, item.access_token, item.last_refresh_at);

    const result = await this.engine.syncItem({
      itemId,
      accessToken: item.access_token,
      trigger,
      pendingLimboGraceHours: this.config.pendingLimboGraceHours,
    });

    if (result.events.length > 0) {
      const sent = await this.dispatcher.dispatch(result.events);
      logger.info(
        {
          itemId,
          trigger,
          added: result.added,
          modified: result.modified,
          removed: result.removed,
          events: result.events.length,
          notified: sent,
        },
        'sync complete',
      );
    } else {
      logger.debug({ itemId, trigger }, 'sync complete; no changes');
    }

    return result;
  }

  /**
   * Ask the provider to pull fresh data before syncing.
   *
   * Without this, an aggregator refreshes an account on its own schedule —
   * often only a few times a day — which is far too coarse to catch a tip
   * being added or a hold being released while it is happening. With it, our
   * poll interval becomes the real resolution of the change ledger.
   *
   * It is rate limited and billable, hence the interval floor and the
   * opt-in flag.
   */
  private async maybeRefresh(itemId: string, accessToken: string, lastRefreshAt: string | null): Promise<void> {
    if (!this.config.enableTransactionsRefresh) return;
    if (!this.provider.refresh) return;

    if (lastRefreshAt) {
      const elapsed = (Date.now() - Date.parse(`${lastRefreshAt.replace(' ', 'T')}Z`)) / 1000;
      if (Number.isFinite(elapsed) && elapsed < this.config.refreshMinIntervalSeconds) {
        logger.debug({ itemId, elapsed }, 'skipping refresh; inside minimum interval');
        return;
      }
    }

    try {
      const performed = await this.provider.refresh(accessToken);
      if (performed) {
        this.repos.items.markRefreshed(itemId);
        logger.debug({ itemId }, 'requested fresh data from institution');
      }
    } catch (err) {
      // A refresh failure must not abort the sync — stale data still beats
      // no data, and the error is recorded on the item.
      logger.warn({ itemId, err: (err as Error).message }, 'refresh failed; syncing with existing data');
    }
  }

  /** Sync every active connection. */
  async syncAll(trigger: SyncTrigger): Promise<SyncResult[]> {
    const items = this.repos.items.listActive();
    if (items.length === 0) {
      logger.debug('no active items to sync');
      return [];
    }

    const results: SyncResult[] = [];
    for (const item of items) {
      try {
        results.push(await this.syncItem(item.item_id, trigger));
      } catch (err) {
        logger.error({ itemId: item.item_id, err: (err as Error).message }, 'unhandled sync failure');
      }
    }

    await this.dispatcher.retryFailed();
    return results;
  }
}
