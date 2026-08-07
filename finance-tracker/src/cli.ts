import webpush from 'web-push';
import { configFrom, loadConfig } from './config.js';
import { getDatabase, openTestDatabase } from './db/index.js';
import { createRepositories } from './db/repositories.js';
import { Orchestrator } from './core/orchestrator.js';
import { TimelineService } from './core/timeline.js';
import { formatAmount, formatMagnitude } from './core/money.js';
import { NotificationDispatcher } from './notify/dispatcher.js';
import { renderNotification } from './notify/render.js';
import { createProvider, MockProvider, PlaidProvider } from './providers/index.js';

const [, , command = 'help', ...args] = process.argv;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function heading(text: string): void {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
  console.log('─'.repeat(Math.min(text.length + 12, 78)));
}

function printTimeline(timeline: TimelineService, limit = 100): void {
  const entries = timeline.list({ limit, order: 'asc' });
  if (entries.length === 0) {
    console.log('  (no events yet)');
    return;
  }
  for (const entry of entries) {
    // Flag the changes that a bank's own history would never show you.
    const marker = entry.ephemeral ? '\x1b[33m●\x1b[0m' : '○';
    console.log(`  ${marker} [${entry.at}] ${entry.headline}`);
    if (entry.detail) console.log(`      ↳ ${entry.detail}`);
  }

  const unresolved = timeline.unresolved();
  if (unresolved.length > 0) {
    console.log('\n  Awaiting resolution (pending charges that left the feed):');
    for (const u of unresolved) {
      console.log(`    ? ${formatMagnitude(u.amount, u.currency)} at ${u.description} — gone since ${u.disappearedAt}`);
    }
  }
}

// ---------------------------------------------------------------------------
// demo — the whole system, end to end, with no credentials
// ---------------------------------------------------------------------------

async function demo(): Promise<void> {
  // Grace of 0 hours so vanished pendings resolve within the demo rather
  // than three days later.
  const config = configFrom({
    PROVIDER: 'mock',
    NOTIFY_CHANNELS: 'console',
    PENDING_LIMBO_GRACE_HOURS: '0',
    LOG_LEVEL: 'warn',
    DATABASE_PATH: ':memory:',
  });

  const db = openTestDatabase();
  const repos = createRepositories(db);
  const bank = new MockProvider();
  const dispatcher = new NotificationDispatcher(config, repos);
  const orchestrator = new Orchestrator(config, repos, bank, dispatcher);
  const timeline = new TimelineService(repos);

  repos.items.upsert({
    itemId: bank.itemId,
    provider: 'mock',
    accessToken: 'mock-access-token',
    institutionName: 'Simulated Savings & Loan',
  });

  const sync = () => orchestrator.syncItem(bank.itemId, 'manual');

  heading('Day 1 — five charges hit the account');
  const coffee = bank.authorize({ amount: -545, name: 'BLUE BOTTLE COFFEE', category: 'FOOD_AND_DRINK' });
  const dinner = bank.authorize({ amount: -6_200, name: 'TARTINE MANUFACTORY', category: 'FOOD_AND_DRINK' });
  const gas = bank.authorize({ amount: -10_000, name: 'SHELL OIL 574', category: 'TRANSPORTATION' });
  const hotel = bank.authorize({ amount: -25_000, name: 'MARRIOTT UNION SQ', category: 'TRAVEL' });
  const verify = bank.authorize({ amount: -100, name: 'AMZN TEMP AUTH', category: 'GENERAL_MERCHANDISE' });
  bank.setBalance('mock-checking', 482_355 - 41_845, 440_510);
  await sync();
  console.log(`  4 pending + 1 verification hold authorized.`);

  heading('Day 2 — the restaurant adds a tip after the fact');
  // Authorized 62.00, settles at 71.30. The bank will only ever show 71.30;
  // the 9.30 difference exists nowhere in its history.
  bank.settle(dinner.transactionId, { finalAmount: -7_130 });
  await sync();

  heading('Day 2 — the fuel hold is released');
  // Authorized a flat $100 hold, settled at the real pump total.
  bank.settle(gas.transactionId, { finalAmount: -4_287 });
  await sync();

  heading('Day 2 — coffee settles unchanged');
  bank.settle(coffee.transactionId);
  await sync();

  heading('Day 3 — the $1 verification hold silently disappears');
  // Never posts. Vanishes from the bank's records entirely.
  bank.dropPending(verify.transactionId);
  await sync();

  heading('Day 3 — the hotel raises its incidentals hold in place');
  bank.modify(hotel.transactionId, { amount: -27_500 });
  bank.setBalance('mock-checking', 415_000, 402_000);
  await sync();

  heading('Day 4 — hotel settles, and the bank omits the pending link');
  // `linkPendingId: false` simulates an institution that does not populate
  // pendingTransactionId, forcing the fuzzy matcher to earn its keep.
  bank.settle(hotel.transactionId, { finalAmount: -24_180, linkPendingId: false });
  await sync();

  heading('Complete change ledger (● = invisible in your bank\'s history)');
  printTimeline(timeline);

  heading('One purchase, start to finish');
  const dinnerEvents = repos.ledger.query({ limit: 500, order: 'asc' }).find((e) => e.description?.includes('TARTINE'));
  if (dinnerEvents?.lifecycleId) {
    const thread = timeline.lifecycle(dinnerEvents.lifecycleId);
    for (const entry of thread.events) {
      console.log(`  · ${entry.at}  ${entry.headline}`);
      if (entry.detail) console.log(`      ↳ ${entry.detail}`);
    }
    console.log(`\n  Stored records in this lifecycle: ${thread.records.length}`);
    for (const record of thread.records) {
      console.log(
        `    - ${record.transaction_id}  ${formatAmount(record.amount, record.currency)}  ` +
          `${record.pending ? 'pending' : 'posted'}  state=${record.state}`,
      );
    }
  }

  heading('Summary');
  const summary = timeline.summary();
  for (const [type, count] of Object.entries(summary.counts).sort()) {
    console.log(`  ${type.padEnd(24)} ${count}`);
  }
  console.log(`  ${'notifications sent'.padEnd(24)} ${dispatcher.stats().sent ?? 0}`);
  console.log(
    '\nEvery one of those events is derived, not reported: the provider only ever said\n' +
      '"added", "modified" or "removed". The tips, the released hold and the vanished\n' +
      'authorization are all reconstructed by diffing and stitching.\n',
  );

  db.close();
}

// ---------------------------------------------------------------------------
// operational commands
// ---------------------------------------------------------------------------

async function syncOnce(): Promise<void> {
  const config = loadConfig();
  const repos = createRepositories(getDatabase());
  const provider = createProvider(config);
  const dispatcher = new NotificationDispatcher(config, repos);
  const orchestrator = new Orchestrator(config, repos, provider, dispatcher);

  const results = await orchestrator.syncAll('manual');
  if (results.length === 0) {
    console.log('No linked accounts yet. Run `npm run cli -- link` to connect one.');
    return;
  }
  for (const r of results) {
    console.log(
      `${r.itemId}: ${r.ok ? 'ok' : `FAILED (${r.error})`} — ` +
        `+${r.added} added, ~${r.modified} modified, -${r.removed} removed, ${r.events.length} ledger events`,
    );
  }
}

function showTimeline(): void {
  const repos = createRepositories(getDatabase());
  const timeline = new TimelineService(repos);
  const limit = Number(args[0] ?? 50);
  heading(`Change ledger (most recent ${limit})`);
  const entries = timeline.list({ limit, order: 'desc' });
  if (entries.length === 0) {
    console.log('  (no events recorded yet)');
    return;
  }
  for (const entry of entries) {
    const marker = entry.ephemeral ? '\x1b[33m●\x1b[0m' : '○';
    console.log(`  ${marker} [${entry.at}] ${entry.headline}`);
    if (entry.detail) console.log(`      ↳ ${entry.detail}`);
  }
}

function showAccounts(): void {
  const repos = createRepositories(getDatabase());
  heading('Accounts');
  const accounts = repos.accounts.list();
  if (accounts.length === 0) {
    console.log('  (none linked)');
    return;
  }
  for (const a of accounts) {
    const balance = a.current_balance === null ? '—' : formatAmount(a.current_balance, a.currency);
    console.log(
      `  ${a.account_id}\n    ${a.name}${a.mask ? ` ••${a.mask}` : ''} (${a.type}/${a.subtype ?? '—'})  ` +
        `balance ${balance}  notify=${a.notify_enabled === 1 ? 'on' : 'off'}` +
        `${a.notify_min_amount > 0 ? ` min ${formatAmount(a.notify_min_amount, a.currency)}` : ''}`,
    );
  }
}

function generateVapidKeys(): void {
  const keys = webpush.generateVAPIDKeys();
  console.log('Add these to your .env:\n');
  console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
  console.log('VAPID_SUBJECT=mailto:you@example.com');
  console.log('\nKeep the private key secret. Regenerating it invalidates every existing device subscription.');
}

async function notifyTest(): Promise<void> {
  const config = loadConfig();
  const repos = createRepositories(getDatabase());
  const dispatcher = new NotificationDispatcher(config, repos);

  // Append a real ledger event so the whole path — dedupe, delivery log,
  // retry bookkeeping — is exercised, not just the transport.
  const event = repos.ledger.append({
    type: 'transaction.added',
    itemId: null,
    accountId: null,
    transactionId: null,
    lifecycleId: null,
    amount: -1_234,
    amountDelta: null,
    currency: 'USD',
    description: 'Test Notification',
    pending: true,
    changes: null,
    metadata: { test: true },
    syncRunId: null,
  });

  const message = renderNotification(event, 'Test Account', config.publicBaseUrl);
  console.log(`Channels: ${dispatcher.channels.join(', ')}`);
  console.log(`Title: ${message.title}`);
  console.log(`Body:  ${message.body}`);

  // shouldNotify() requires a known account; deliver directly for the test.
  let sent = 0;
  for (const channel of dispatcher.channels) {
    const notifiers = NotificationDispatcher.buildNotifiers(config, repos.db);
    const notifier = notifiers.find((n) => n.channel === channel);
    if (!notifier) continue;
    const results = await notifier.send(message);
    for (const r of results) {
      console.log(`  ${r.channel} -> ${r.target}: ${r.ok ? 'sent' : `FAILED (${r.error})`}`);
      if (r.ok) sent += 1;
    }
  }
  console.log(sent > 0 ? '\nDelivered.' : '\nNothing was delivered — check your channel configuration.');
}

async function linkFlow(): Promise<void> {
  const config = loadConfig();
  const provider = createProvider(config);
  if (!(provider instanceof PlaidProvider)) {
    console.log(`PROVIDER is "${config.provider}". Set PROVIDER=plaid and supply credentials to link a real bank.`);
    return;
  }
  const token = await provider.createLinkToken('primary-user');
  console.log('Link token (valid ~4 hours):\n');
  console.log(`  ${token}\n`);
  console.log('Open the Link UI with this token, complete the bank login, then POST the');
  console.log('public token it returns to /api/link/exchange to finish connecting.');
}

function help(): void {
  console.log(`
finance-tracker

  demo             Run a full simulated account through the change ledger.
                   Needs no credentials — start here.
  sync             Sync every linked connection once and notify.
  timeline [n]     Print the most recent n ledger events (default 50).
  accounts         List tracked accounts and their notification settings.
  notify-test      Send a test notification through every configured channel.
  vapid-keys       Generate a Web Push VAPID keypair.
  link             Mint a Plaid Link token to connect a bank.
  help             This message.

Run the server (webhooks + polling + API) with: npm run dev
`);
}

// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  switch (command) {
    case 'demo':
      return demo();
    case 'sync':
      return syncOnce();
    case 'timeline':
      return showTimeline();
    case 'accounts':
      return showAccounts();
    case 'vapid-keys':
      return generateVapidKeys();
    case 'notify-test':
      return notifyTest();
    case 'link':
      return linkFlow();
    default:
      return help();
  }
}

run().catch((err: unknown) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
