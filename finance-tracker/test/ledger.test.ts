import { describe, it, expect, afterEach } from 'vitest';
import { createHarness, type Harness } from './helpers.js';
import { TimelineService } from '../src/core/timeline.js';

let h: Harness;
afterEach(() => h?.close());

describe('the change ledger (feature 2)', () => {
  it('records a full purchase history in chronological order', async () => {
    h = createHarness();

    const dinner = h.bank.authorize({ amount: -6_200, name: 'TARTINE MANUFACTORY' });
    await h.sync();
    h.bank.settle(dinner.transactionId, { finalAmount: -7_130 });
    await h.sync();

    const types = h.events().map((e) => e.type);
    expect(types).toEqual(['account.added', 'transaction.added', 'transaction.posted']);
  });

  it('is append-only: past events are never rewritten', async () => {
    h = createHarness();
    const tx = h.bank.authorize({ amount: -6_200, name: 'TARTINE' });
    await h.sync();
    const snapshot = h.events().map((e) => ({ id: e.id, type: e.type, amount: e.amount }));

    h.bank.settle(tx.transactionId, { finalAmount: -7_130 });
    await h.sync();

    const after = h.events();
    // The original "pending $62.00" row still reads $62.00 afterwards.
    for (const original of snapshot) {
      const still = after.find((e) => e.id === original.id)!;
      expect(still.type).toBe(original.type);
      expect(still.amount).toBe(original.amount);
    }
  });

  it('keeps a reconstructible snapshot of every observed state', async () => {
    h = createHarness();
    const tx = h.bank.authorize({ amount: -1_000, name: 'SHOP' });
    await h.sync();
    h.bank.modify(tx.transactionId, { amount: -1_500 });
    await h.sync();
    h.bank.modify(tx.transactionId, { amount: -1_750 });
    await h.sync();

    const versions = h.repos.transactions.listVersions(tx.transactionId);
    expect(versions.map((v) => v.snapshot.amount)).toEqual([-1_000, -1_500, -1_750]);
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it('groups a purchase under one lifecycle across the id change at settlement', async () => {
    h = createHarness();
    const tx = h.bank.authorize({ amount: -6_200, name: 'TARTINE' });
    await h.sync();
    h.bank.settle(tx.transactionId, { finalAmount: -7_130 });
    await h.sync();

    const timeline = new TimelineService(h.repos);
    const lifecycleId = h.events().find((e) => e.type === 'transaction.posted')!.lifecycleId!;
    const thread = timeline.lifecycle(lifecycleId);

    expect(thread.events).toHaveLength(2);
    expect(thread.records).toHaveLength(2);
    expect(thread.events[0]!.headline).toContain('Pending');
    expect(thread.events[1]!.headline).toContain('Posted');
  });

  it('supports filtering and keyset pagination', async () => {
    h = createHarness();
    for (let i = 0; i < 12; i += 1) {
      h.bank.authorize({ amount: -(100 + i), name: `MERCHANT ${i}` });
    }
    await h.sync();

    const firstPage = h.repos.ledger.query({ limit: 5, order: 'desc' });
    expect(firstPage).toHaveLength(5);

    const secondPage = h.repos.ledger.query({ limit: 5, order: 'desc', beforeId: firstPage.at(-1)!.id });
    expect(secondPage).toHaveLength(5);
    // No overlap between pages.
    const ids = new Set(firstPage.map((e) => e.id));
    expect(secondPage.some((e) => ids.has(e.id))).toBe(false);

    const onlyAdds = h.repos.ledger.query({ types: ['transaction.added'], limit: 100 });
    expect(onlyAdds).toHaveLength(12);
  });
});

describe('timeline presentation', () => {
  it('flags the changes a bank would never show you', async () => {
    h = createHarness();
    const dinner = h.bank.authorize({ amount: -6_200, name: 'TARTINE MANUFACTORY' });
    const hold = h.bank.authorize({ amount: -100, name: 'TEMP AUTH' });
    await h.sync();

    h.bank.settle(dinner.transactionId, { finalAmount: -7_130 });
    h.bank.dropPending(hold.transactionId);
    await h.sync();

    const timeline = new TimelineService(h.repos);
    const entries = timeline.list({ limit: 100, order: 'asc' });

    const posted = entries.find((e) => e.type === 'transaction.posted')!;
    const vanished = entries.find((e) => e.type === 'transaction.vanished')!;
    const plainAdd = entries.find((e) => e.type === 'transaction.added')!;

    expect(posted.ephemeral).toBe(true);
    expect(vanished.ephemeral).toBe(true);
    expect(plainAdd.ephemeral).toBe(false);

    expect(posted.detail).toContain('Authorized $62.00, settled $71.30');
  });

  it('surfaces pending charges still awaiting resolution', async () => {
    h = createHarness({ PENDING_LIMBO_GRACE_HOURS: '72' });
    const hold = h.bank.authorize({ amount: -100, name: 'TEMP AUTH' });
    await h.sync();
    h.bank.dropPending(hold.transactionId);
    await h.sync();

    // Not yet in the ledger, and gone from the bank — but not invisible.
    const timeline = new TimelineService(h.repos);
    const open = timeline.unresolved();
    expect(open).toHaveLength(1);
    expect(open[0]!.amount).toBe(-100);
  });

  it('summarises activity by event type', async () => {
    h = createHarness();
    const tx = h.bank.authorize({ amount: -1_000, name: 'SHOP' });
    await h.sync();
    h.bank.settle(tx.transactionId);
    await h.sync();

    const summary = new TimelineService(h.repos).summary();
    expect(summary.counts['transaction.added']).toBe(1);
    expect(summary.counts['transaction.posted']).toBe(1);
    expect(summary.accounts).toBe(1);
  });
});

describe('sync robustness', () => {
  it('is idempotent when the same page is replayed', async () => {
    h = createHarness();
    h.bank.authorize({ amount: -1_000, name: 'SHOP' });
    await h.sync();
    const first = h.events().length;

    // Rewind the cursor and replay the identical history.
    h.repos.db.prepare('UPDATE items SET cursor = NULL').run();
    await h.sync();

    expect(h.events()).toHaveLength(first);
  });

  it('paginates through a change feed larger than one page', async () => {
    h = createHarness();
    // Page size 3 forces four round trips for ten changes.
    const bank = new (await import('../src/providers/mock.js')).MockProvider('mock-item-1', 3);
    for (let i = 0; i < 10; i += 1) bank.authorize({ amount: -(500 + i), name: `SHOP ${i}` });

    const { Orchestrator } = await import('../src/core/orchestrator.js');
    const orchestrator = new Orchestrator(h.config, h.repos, bank, h.dispatcher);
    const result = await orchestrator.syncItem('mock-item-1', 'manual');

    expect(result.pages).toBe(4);
    expect(h.eventsOfType('transaction.added')).toHaveLength(10);
  });

  it('records a sync failure so gaps in the ledger are explainable', async () => {
    h = createHarness();
    h.bank.syncPage = async () => {
      throw new Error('institution unavailable');
    };

    const result = await h.orchestrator.syncItem('mock-item-1', 'manual');
    expect(result.ok).toBe(false);

    const errors = h.eventsOfType('sync.error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.metadata?.error).toContain('institution unavailable');
    expect(h.repos.items.get('mock-item-1')!.consecutive_errors).toBe(1);
  });

  it('flags a connection that needs re-authentication', async () => {
    h = createHarness();
    const { ProviderReauthRequired } = await import('../src/providers/types.js');
    h.bank.syncPage = async () => {
      throw new ProviderReauthRequired('ITEM_LOGIN_REQUIRED');
    };

    await h.orchestrator.syncItem('mock-item-1', 'manual');
    expect(h.repos.items.get('mock-item-1')!.status).toBe('needs_reauth');
  });

  it('clears the error state once a sync succeeds again', async () => {
    h = createHarness();
    const original = h.bank.syncPage.bind(h.bank);
    h.bank.syncPage = async () => {
      throw new Error('transient');
    };
    await h.orchestrator.syncItem('mock-item-1', 'manual');
    expect(h.repos.items.get('mock-item-1')!.consecutive_errors).toBe(1);

    h.bank.syncPage = original;
    await h.orchestrator.syncItem('mock-item-1', 'manual');

    const item = h.repos.items.get('mock-item-1')!;
    expect(item.consecutive_errors).toBe(0);
    expect(item.last_error).toBeNull();
  });

  it('joins an in-flight sync instead of running two at once', async () => {
    h = createHarness();
    h.bank.authorize({ amount: -1_000, name: 'SHOP' });

    // A poll tick and a webhook arriving together must not both consume the
    // cursor and double-write the same events.
    const [a, b] = await Promise.all([
      h.orchestrator.syncItem('mock-item-1', 'poll'),
      h.orchestrator.syncItem('mock-item-1', 'webhook'),
    ]);

    expect(a.runId).toBe(b.runId);
    expect(h.eventsOfType('transaction.added')).toHaveLength(1);
  });

  it('advances the cursor only after events are committed', async () => {
    h = createHarness();
    h.bank.authorize({ amount: -1_000, name: 'SHOP' });
    await h.sync();

    const cursor = h.repos.items.get('mock-item-1')!.cursor;
    expect(cursor).toBe('mock:1');

    // A second sync with nothing new must produce nothing.
    const events = await h.sync();
    expect(events).toHaveLength(0);
  });
});
