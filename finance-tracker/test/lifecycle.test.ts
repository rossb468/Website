import { describe, it, expect, afterEach } from 'vitest';
import { createHarness, type Harness } from './helpers.js';

/**
 * The scenarios that motivate the whole project: changes that a bank's own
 * transaction history either shows only in final form, or never shows at all.
 */

let h: Harness;
afterEach(() => h?.close());

describe('pending → posted settlement', () => {
  it('records a tip added after the fact as a single settlement with a delta', async () => {
    h = createHarness();

    // Dinner authorized at $62.00.
    const dinner = h.bank.authorize({ amount: -6_200, name: 'TARTINE MANUFACTORY' });
    await h.sync();

    // Settles at $71.30 once the tip is added. The bank will only ever show
    // $71.30; the $9.30 difference is invisible in its history.
    h.bank.settle(dinner.transactionId, { finalAmount: -7_130 });
    const events = await h.sync();

    const posted = events.filter((e) => e.type === 'transaction.posted');
    expect(posted).toHaveLength(1);
    expect(posted[0]!.amount).toBe(-7_130);
    expect(posted[0]!.amountDelta).toBe(-930);
    expect(posted[0]!.metadata?.pendingAmount).toBe(-6_200);
    expect(posted[0]!.metadata?.postedAmount).toBe(-7_130);
    expect(posted[0]!.metadata?.amountIncreased).toBe(true);
    expect(posted[0]!.metadata?.settlement).toBe('linked');

    // Crucially: no spurious "vanished" or second "added" event.
    expect(h.eventsOfType('transaction.vanished')).toHaveLength(0);
    expect(h.eventsOfType('transaction.added')).toHaveLength(1);
  });

  it('records a released hold as a decrease', async () => {
    h = createHarness();

    // Fuel pumps authorize a flat hold and settle far lower.
    const gas = h.bank.authorize({ amount: -10_000, name: 'SHELL OIL 574' });
    await h.sync();

    h.bank.settle(gas.transactionId, { finalAmount: -4_287 });
    const events = await h.sync();

    const posted = events.find((e) => e.type === 'transaction.posted');
    expect(posted).toBeDefined();
    expect(posted!.amountDelta).toBe(5_713);
    expect(posted!.metadata?.amountIncreased).toBe(false);
  });

  it('keeps both records on one lifecycle so the purchase reads as one thread', async () => {
    h = createHarness();

    const coffee = h.bank.authorize({ amount: -545, name: 'BLUE BOTTLE' });
    await h.sync();
    const settled = h.bank.settle(coffee.transactionId, { finalAmount: -645 });
    await h.sync();

    const pendingRow = h.repos.transactions.get(coffee.transactionId)!;
    const postedRow = h.repos.transactions.get(settled.transactionId)!;

    expect(postedRow.lifecycle_id).toBe(pendingRow.lifecycle_id);
    // The pending record is retained, flagged as replaced rather than deleted.
    expect(pendingRow.state).toBe('superseded');
    expect(postedRow.state).toBe('present');

    const thread = h.repos.transactions.listByLifecycle(pendingRow.lifecycle_id);
    expect(thread).toHaveLength(2);
  });

  it('emits no delta when the settled amount matches the authorization', async () => {
    h = createHarness();
    const tx = h.bank.authorize({ amount: -1_599, name: 'NETFLIX.COM' });
    await h.sync();
    h.bank.settle(tx.transactionId);
    const events = await h.sync();

    const posted = events.find((e) => e.type === 'transaction.posted');
    expect(posted!.amountDelta).toBe(0);
  });

  it('stitches when the settlement arrives in the same sync as the removal', async () => {
    h = createHarness();
    const tx = h.bank.authorize({ amount: -2_000, name: 'CAFE X' });
    await h.sync();

    // Both the removal and the new posted record land in one page — the
    // ordering inside applyPage is what makes this work.
    h.bank.settle(tx.transactionId, { finalAmount: -2_400 });
    const events = await h.sync();

    expect(events.filter((e) => e.type === 'transaction.posted')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'transaction.vanished')).toHaveLength(0);
  });

  it('stitches when the removal and the settlement arrive in separate syncs', async () => {
    h = createHarness({ PENDING_LIMBO_GRACE_HOURS: '72' });
    const tx = h.bank.authorize({ amount: -2_000, name: 'CAFE X' });
    await h.sync();

    h.bank.settle(tx.transactionId, { finalAmount: -2_400 });
    await h.sync();

    const posted = h.eventsOfType('transaction.posted');
    expect(posted).toHaveLength(1);
    expect(posted[0]!.amountDelta).toBe(-400);
    // Limbo entry resolved rather than left dangling.
    expect(h.repos.limbo.listOpen()).toHaveLength(0);
    expect(h.repos.limbo.get(tx.transactionId)?.resolution).toBe('posted');
  });
});

describe('pending charges that never settle', () => {
  it('reports a dropped authorization hold as vanished', async () => {
    h = createHarness();

    // A $1 card-verification hold: appears, moves available balance, then
    // silently disappears. It never reaches the bank's transaction history.
    const hold = h.bank.authorize({ amount: -100, name: 'AMZN TEMP AUTH' });
    await h.sync();

    h.bank.dropPending(hold.transactionId);
    const events = await h.sync();

    const vanished = events.filter((e) => e.type === 'transaction.vanished');
    expect(vanished).toHaveLength(1);
    expect(vanished[0]!.amount).toBe(-100);
    expect(vanished[0]!.transactionId).toBe(hold.transactionId);
    expect(vanished[0]!.metadata?.reason).toBe('pending charge never settled');
    expect(h.repos.transactions.get(hold.transactionId)!.state).toBe('vanished');
  });

  it('waits out the grace period before declaring a pending charge gone', async () => {
    h = createHarness({ PENDING_LIMBO_GRACE_HOURS: '72' });

    const hold = h.bank.authorize({ amount: -100, name: 'AMZN TEMP AUTH' });
    await h.sync();
    h.bank.dropPending(hold.transactionId);
    await h.sync();

    // Still unresolved: it may yet settle, so nothing is claimed prematurely.
    expect(h.eventsOfType('transaction.vanished')).toHaveLength(0);
    const open = h.repos.limbo.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0]!.transaction_id).toBe(hold.transactionId);
  });

  it('dates a vanished event to when the charge disappeared, not when we concluded it', async () => {
    h = createHarness();
    const hold = h.bank.authorize({ amount: -100, name: 'TEMP AUTH' });
    await h.sync();
    h.bank.dropPending(hold.transactionId);
    await h.sync();

    const vanished = h.eventsOfType('transaction.vanished')[0]!;
    // The ledger reads in true chronological order rather than by the moment
    // the grace period happened to lapse.
    expect(vanished.observedAt).toBe(vanished.metadata?.disappearedAt);
  });
});

describe('in-place changes', () => {
  it('records an amount change on a still-pending charge', async () => {
    h = createHarness();
    const hotel = h.bank.authorize({ amount: -25_000, name: 'MARRIOTT UNION SQ' });
    await h.sync();

    // Hotel raises its incidentals hold mid-stay.
    h.bank.modify(hotel.transactionId, { amount: -27_500 });
    const events = await h.sync();

    const changed = events.filter((e) => e.type === 'transaction.changed');
    expect(changed).toHaveLength(1);
    expect(changed[0]!.amountDelta).toBe(-2_500);
    expect(changed[0]!.changes).toEqual([{ field: 'amount', before: -25_000, after: -27_500 }]);
  });

  it('treats a pending flag flipping in place as a settlement', async () => {
    h = createHarness();
    const tx = h.bank.authorize({ amount: -3_000, name: 'CORNER STORE' });
    await h.sync();

    // Some institutions settle without issuing a new transaction id.
    h.bank.modify(tx.transactionId, { pending: false, amount: -3_450 });
    const events = await h.sync();

    const posted = events.filter((e) => e.type === 'transaction.posted');
    expect(posted).toHaveLength(1);
    expect(posted[0]!.metadata?.settlement).toBe('in_place');
    expect(posted[0]!.amountDelta).toBe(-450);
  });

  it('records a posted transaction withdrawn by the bank', async () => {
    h = createHarness();
    const tx = h.bank.authorize({ amount: -5_000, name: 'DUPLICATE CHARGE', pending: false });
    await h.sync();

    h.bank.removePosted(tx.transactionId);
    const events = await h.sync();

    const removed = events.filter((e) => e.type === 'transaction.removed');
    expect(removed).toHaveLength(1);
    expect(removed[0]!.amount).toBe(-5_000);
    // A posted removal is unambiguous, so it is never routed through limbo.
    expect(h.repos.limbo.listOpen()).toHaveLength(0);
  });

  it('produces no event when a modification changes nothing we track', async () => {
    h = createHarness();
    const tx = h.bank.authorize({ amount: -1_000, name: 'SHOP' });
    await h.sync();

    // Only the opaque provider blob changed.
    h.bank.modify(tx.transactionId, { raw: { enrichmentVersion: 2 } });
    const events = await h.sync();

    expect(events).toHaveLength(0);
  });
});

describe('institutions that omit the pending link', () => {
  it('matches a settlement to its authorization heuristically', async () => {
    h = createHarness();
    const dinner = h.bank.authorize({ amount: -6_200, name: 'TARTINE MANUFACTORY' });
    await h.sync();

    h.bank.settle(dinner.transactionId, { finalAmount: -7_130, linkPendingId: false });
    const events = await h.sync();

    const posted = events.filter((e) => e.type === 'transaction.posted');
    expect(posted).toHaveLength(1);
    expect(posted[0]!.metadata?.settlement).toBe('fuzzy');
    expect(posted[0]!.amountDelta).toBe(-930);
    expect(h.eventsOfType('transaction.vanished')).toHaveLength(0);
  });

  it('matches the only pending charge that disappeared', async () => {
    h = createHarness({ PENDING_LIMBO_GRACE_HOURS: '72' });

    // Two identical coffees the same day, but only one leaves the feed. The
    // other is still pending, so it cannot be the one that settled.
    const a = h.bank.authorize({ amount: -500, name: 'BLUE BOTTLE COFFEE' });
    h.bank.authorize({ amount: -500, name: 'BLUE BOTTLE COFFEE' });
    await h.sync();

    h.bank.settle(a.transactionId, { finalAmount: -500, linkPendingId: false });
    const events = await h.sync();

    const posted = events.filter((e) => e.type === 'transaction.posted');
    expect(posted).toHaveLength(1);
    expect(posted[0]!.metadata?.pendingTransactionId).toBe(a.transactionId);
  });

  it('declines to guess when two indistinguishable charges both disappear', async () => {
    h = createHarness({ PENDING_LIMBO_GRACE_HOURS: '72' });

    const a = h.bank.authorize({ amount: -500, name: 'BLUE BOTTLE COFFEE' });
    const b = h.bank.authorize({ amount: -500, name: 'BLUE BOTTLE COFFEE' });
    await h.sync();

    // Both leave the feed and a single unlinked settlement arrives. Nothing
    // in the data says which authorization it belongs to.
    h.bank.settle(a.transactionId, { finalAmount: -500, linkPendingId: false });
    h.bank.dropPending(b.transactionId);
    const events = await h.sync();

    // Refusing to stitch is the correct outcome: an unmatched pending is a
    // far less harmful error than welding two real purchases together.
    expect(events.filter((e) => e.type === 'transaction.posted')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'transaction.added')).toHaveLength(1);
    expect(h.repos.limbo.listOpen()).toHaveLength(2);
  });

  it('does not match an unrelated charge to a vanished pending', async () => {
    h = createHarness({ PENDING_LIMBO_GRACE_HOURS: '72' });

    const hold = h.bank.authorize({ amount: -100, name: 'AMZN TEMP AUTH' });
    await h.sync();
    h.bank.dropPending(hold.transactionId);
    await h.sync();

    // A completely different, much larger purchase arrives afterwards.
    h.bank.authorize({ amount: -45_000, name: 'DELTA AIR LINES', pending: false });
    const events = await h.sync();

    expect(events.filter((e) => e.type === 'transaction.posted')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'transaction.added')).toHaveLength(1);
  });
});
