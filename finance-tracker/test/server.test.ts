import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createHarness, type Harness } from './helpers.js';
import { createApp } from '../src/server/app.js';

const TOKEN = 'test-token-0123456789';

let h: Harness;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  h = createHarness({ API_TOKEN: TOKEN });
  const app = createApp({
    config: h.config,
    repos: h.repos,
    provider: h.bank,
    orchestrator: h.orchestrator,
    dispatcher: h.dispatcher,
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  h?.close();
});

const authed = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });

describe('HTTP API', () => {
  it('serves health without a token', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.provider).toBe('mock');
  });

  it('rejects unauthenticated access to account data', async () => {
    const res = await fetch(`${baseUrl}/api/timeline`);
    expect(res.status).toBe(401);
  });

  it('rejects a wrong token', async () => {
    const res = await fetch(`${baseUrl}/api/timeline`, { headers: { Authorization: 'Bearer wrong-token-here' } });
    expect(res.status).toBe(401);
  });

  it('returns the change ledger with a pagination cursor', async () => {
    h.bank.authorize({ amount: -4_230, name: 'BLUE BOTTLE COFFEE' });
    await h.sync();

    const res = await authed('/api/timeline?limit=10');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries[0].headline).toBeTruthy();
    expect(body.nextBeforeId).toBeTypeOf('number');
  });

  it('filters the ledger by event type', async () => {
    const tx = h.bank.authorize({ amount: -6_200, name: 'TARTINE' });
    await h.sync();
    h.bank.settle(tx.transactionId, { finalAmount: -7_130 });
    await h.sync();

    const res = await authed('/api/timeline?types=transaction.posted');
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].type).toBe('transaction.posted');
  });

  it('ignores unknown event types in the filter rather than erroring', async () => {
    await h.sync();
    const res = await authed('/api/timeline?types=not-a-real-type');
    expect(res.status).toBe(200);
  });

  it('returns one purchase thread and its stored records', async () => {
    const tx = h.bank.authorize({ amount: -6_200, name: 'TARTINE' });
    await h.sync();
    h.bank.settle(tx.transactionId, { finalAmount: -7_130 });
    await h.sync();

    const lifecycleId = h.events().find((e) => e.type === 'transaction.posted')!.lifecycleId!;
    const res = await authed(`/api/timeline/lifecycle/${lifecycleId}`);
    const body = await res.json();

    expect(body.events).toHaveLength(2);
    expect(body.records).toHaveLength(2);
  });

  it('404s an unknown lifecycle', async () => {
    const res = await authed('/api/timeline/lifecycle/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns the observed version history of a transaction', async () => {
    const tx = h.bank.authorize({ amount: -1_000, name: 'SHOP' });
    await h.sync();
    h.bank.modify(tx.transactionId, { amount: -1_500 });
    await h.sync();

    const res = await authed(`/api/transactions/${tx.transactionId}/versions`);
    const body = await res.json();
    expect(body.versions.map((v: { snapshot: { amount: number } }) => v.snapshot.amount)).toEqual([-1_000, -1_500]);
  });

  it('lists accounts and updates notification preferences', async () => {
    await h.sync();

    const list = await (await authed('/api/accounts')).json();
    expect(list.accounts).toHaveLength(1);
    expect(list.accounts[0].notifyEnabled).toBe(true);

    const patch = await authed('/api/accounts/mock-checking/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false, minAmount: 2_500 }),
    });
    expect(patch.status).toBe(200);

    const after = await (await authed('/api/accounts')).json();
    expect(after.accounts[0].notifyEnabled).toBe(false);
    expect(after.accounts[0].notifyMinAmount).toBe(2_500);
  });

  it('triggers a sync on demand', async () => {
    h.bank.authorize({ amount: -1_000, name: 'SHOP' });
    const res = await authed('/api/sync', { method: 'POST', body: '{}' });
    const body = await res.json();

    expect(body.results[0].ok).toBe(true);
    expect(body.results[0].added).toBe(1);
  });

  it('refuses Plaid Link routes when the active provider is not Plaid', async () => {
    const res = await authed('/api/link/token', { method: 'POST', body: '{}' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Plaid-specific');
  });

  it('404s unknown routes as JSON', async () => {
    const res = await authed('/api/nope');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('no route');
  });
});

describe('Link page', () => {
  it('serves the connection page without a token', async () => {
    // Must be reachable unauthenticated: it is where you go to *enter* the
    // token, so gating it behind the token would be a deadlock.
    const res = await fetch(`${baseUrl}/link`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Connect a bank');
    // The Plaid Link SDK must actually be loaded or the page is inert.
    expect(html).toContain('cdn.plaid.com/link/v2/stable/link-initialize.js');
    expect(html).toContain('/api/link/exchange');
  });

  it('redirects the root to the Link page', async () => {
    const res = await fetch(`${baseUrl}/`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/link');
  });

  it('reports the Plaid environment on health so the page can warn you', async () => {
    const body = await (await fetch(`${baseUrl}/health`)).json();
    // Mock provider: no Plaid environment to report.
    expect(body).toHaveProperty('plaidEnv');
    expect(body.plaidEnv).toBeNull();
  });
});

describe('webhook endpoint', () => {
  it('accepts a valid transactions webhook and syncs', async () => {
    h.bank.authorize({ amount: -4_230, name: 'BLUE BOTTLE COFFEE' });

    const res = await fetch(`${baseUrl}/webhooks/plaid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhook_type: 'TRANSACTIONS',
        webhook_code: 'SYNC_UPDATES_AVAILABLE',
        item_id: 'mock-item-1',
      }),
    });
    expect(res.status).toBe(200);

    // The handler acknowledges before syncing, so give the sync a moment.
    await new Promise((r) => setTimeout(r, 150));
    expect(h.eventsOfType('transaction.added')).toHaveLength(1);
  });

  it('rejects malformed JSON', async () => {
    const res = await fetch(`${baseUrl}/webhooks/plaid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('ignores webhooks for other products', async () => {
    const res = await fetch(`${baseUrl}/webhooks/plaid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook_type: 'ITEM', webhook_code: 'ERROR', item_id: 'mock-item-1' }),
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(h.eventsOfType('transaction.added')).toHaveLength(0);
  });
});
