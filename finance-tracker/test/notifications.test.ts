import { describe, it, expect, afterEach } from 'vitest';
import { createHarness, type Harness } from './helpers.js';
import { renderNotification } from '../src/notify/render.js';
import type { LedgerEvent } from '../src/core/types.js';

let h: Harness;
afterEach(() => h?.close());

function event(overrides: Partial<LedgerEvent> = {}): LedgerEvent {
  return {
    id: 1,
    observedAt: '2026-03-10 12:00:00',
    type: 'transaction.added',
    itemId: 'i1',
    accountId: 'a1',
    transactionId: 't1',
    lifecycleId: 'l1',
    amount: -4_230,
    amountDelta: null,
    currency: 'USD',
    description: 'Blue Bottle Coffee',
    pending: true,
    changes: null,
    metadata: null,
    syncRunId: 1,
    ...overrides,
  };
}

describe('notification delivery (feature 1)', () => {
  it('pushes a notification for every new transaction', async () => {
    h = createHarness();

    h.bank.authorize({ amount: -4_230, name: 'BLUE BOTTLE COFFEE' });
    h.bank.authorize({ amount: -1_200, name: 'CORNER DELI' });
    await h.sync();

    expect(h.notifier.sent).toHaveLength(2);
    expect(h.notifier.sent[0]!.title).toContain('BLUE BOTTLE');
    expect(h.notifier.sent[0]!.title).toContain('$42.30');
  });

  it('never sends the same event twice, even if a sync is replayed', async () => {
    h = createHarness();
    h.bank.authorize({ amount: -4_230, name: 'BLUE BOTTLE COFFEE' });
    await h.sync();
    expect(h.notifier.sent).toHaveLength(1);

    // Re-dispatching the identical events must be a no-op: the unique
    // (event, channel) claim is what prevents a second buzz.
    const sent = await h.dispatcher.dispatch(h.events());
    expect(sent).toBe(0);
    expect(h.notifier.sent).toHaveLength(1);
  });

  it('does not re-notify when the provider replays history after a cursor reset', async () => {
    h = createHarness();
    h.bank.authorize({ amount: -4_230, name: 'BLUE BOTTLE COFFEE' });
    await h.sync();

    // Simulate the provider rejecting our cursor: sync again from scratch.
    h.repos.db.prepare('UPDATE items SET cursor = NULL').run();
    await h.sync();

    expect(h.notifier.sent).toHaveLength(1);
    expect(h.eventsOfType('transaction.added')).toHaveLength(1);
  });

  it('honours the per-account mute switch', async () => {
    h = createHarness();
    h.bank.authorize({ amount: -1_000, name: 'FIRST' });
    await h.sync();
    expect(h.notifier.sent).toHaveLength(1);

    h.repos.accounts.setNotifyPreferences('mock-checking', { enabled: false });
    h.bank.authorize({ amount: -2_000, name: 'SECOND' });
    await h.sync();

    expect(h.notifier.sent).toHaveLength(1);
    // The change is still recorded — muting affects pushes, not the ledger.
    expect(h.eventsOfType('transaction.added')).toHaveLength(2);
  });

  it('suppresses amounts below the per-account threshold', async () => {
    h = createHarness();
    await h.sync();
    h.repos.accounts.setNotifyPreferences('mock-checking', { minAmount: 2_000 });

    h.bank.authorize({ amount: -500, name: 'SMALL' });
    h.bank.authorize({ amount: -5_000, name: 'LARGE' });
    await h.sync();

    expect(h.notifier.sent).toHaveLength(1);
    expect(h.notifier.sent[0]!.title).toContain('LARGE');
  });

  it('stays quiet for routine recategorizations', async () => {
    h = createHarness();
    const tx = h.bank.authorize({ amount: -1_000, name: 'SHOP' });
    await h.sync();
    const before = h.notifier.sent.length;

    h.bank.modify(tx.transactionId, { category: 'GENERAL_MERCHANDISE' });
    await h.sync();

    // Recorded in the ledger, but not worth a push — pushing every one of
    // these trains the user to ignore the notifications.
    expect(h.notifier.sent).toHaveLength(before);
    expect(h.eventsOfType('transaction.changed')).toHaveLength(1);
  });

  it('retries a delivery that failed rather than dropping it', async () => {
    h = createHarness();
    h.notifier.failNext = true;

    h.bank.authorize({ amount: -1_000, name: 'FLAKY' });
    await h.sync();
    expect(h.notifier.sent).toHaveLength(0);

    const retried = await h.dispatcher.retryFailed();
    expect(retried).toBe(1);
    expect(h.notifier.sent).toHaveLength(1);
  });

  it('reports connection failures, which belong to no account', async () => {
    h = createHarness();
    const syncError = (consecutiveErrors: number) =>
      h.repos.ledger.append({
        type: 'sync.error',
        itemId: 'mock-item-1',
        accountId: null,
        transactionId: null,
        lifecycleId: null,
        amount: null,
        amountDelta: null,
        currency: null,
        description: 'Connection needs re-authentication',
        pending: null,
        changes: null,
        metadata: { error: 'ITEM_LOGIN_REQUIRED', consecutiveErrors },
        syncRunId: null,
      });

    // A tracker that has gone silent looks exactly like a quiet account, so
    // this is the one event that bypasses account targeting.
    expect(h.dispatcher.shouldNotify(syncError(1))).toBe(true);

    // A bank down for hours must not alert on every poll: alerts decay to
    // failures 1, 2, 4, 8, …
    expect(h.dispatcher.shouldNotify(syncError(2))).toBe(true);
    expect(h.dispatcher.shouldNotify(syncError(3))).toBe(false);
    expect(h.dispatcher.shouldNotify(syncError(4))).toBe(true);
    expect(h.dispatcher.shouldNotify(syncError(7))).toBe(false);
    expect(h.dispatcher.shouldNotify(syncError(8))).toBe(true);
  });

  it('alerts when a real sync failure occurs', async () => {
    h = createHarness();
    await h.sync();
    const before = h.notifier.sent.length;

    // Break the provider mid-flight.
    h.bank.syncPage = async () => {
      throw new Error('ITEM_LOGIN_REQUIRED: the login details are no longer valid');
    };
    await h.sync();

    expect(h.notifier.sent.length).toBe(before + 1);
    expect(h.notifier.sent.at(-1)!.title).toContain('connection problem');
  });
});

describe('notification copy', () => {
  it('leads with amount and merchant for a new charge', () => {
    const m = renderNotification(event(), 'Everyday Checking');
    expect(m.title).toBe('$42.30 pending at Blue Bottle Coffee');
    expect(m.priority).toBe('normal');
  });

  it('spells out the authorized-versus-settled gap when a tip is added', () => {
    const m = renderNotification(
      event({
        type: 'transaction.posted',
        amount: -7_130,
        amountDelta: -930,
        pending: false,
        description: 'Tartine Manufactory',
        metadata: { pendingAmount: -6_200, postedAmount: -7_130 },
      }),
      'Everyday Checking',
    );
    expect(m.title).toContain('↑');
    expect(m.body).toContain('$71.30');
    expect(m.body).toContain('$62.00');
    expect(m.body).toContain('+$9.30');
    // Worth interrupting for: the amount changed after the fact.
    expect(m.priority).toBe('high');
  });

  it('shows a released hold as a decrease', () => {
    const m = renderNotification(
      event({
        type: 'transaction.posted',
        amount: -4_287,
        amountDelta: 5_713,
        pending: false,
        description: 'Shell Oil',
        metadata: { pendingAmount: -10_000, postedAmount: -4_287 },
      }),
      'Everyday Checking',
    );
    expect(m.title).toContain('↓');
    expect(m.body).toContain('−$57.13');
  });

  it('explains that a vanished charge will not appear in bank history', () => {
    const m = renderNotification(event({ type: 'transaction.vanished', amount: -100 }), 'Everyday Checking');
    expect(m.title).toContain('disappeared');
    expect(m.body).toContain("bank's transaction history");
    expect(m.priority).toBe('high');
  });

  it('deep-links to the purchase thread when a public URL is configured', () => {
    const m = renderNotification(event(), 'Everyday Checking', 'https://tracker.example.com');
    expect(m.url).toBe('https://tracker.example.com/api/timeline/lifecycle/l1');
  });
});
