import { configFrom, type Config } from '../src/config.js';
import { openTestDatabase } from '../src/db/index.js';
import { createRepositories, type Repositories } from '../src/db/repositories.js';
import { Orchestrator } from '../src/core/orchestrator.js';
import { NotificationDispatcher } from '../src/notify/dispatcher.js';
import { MockProvider } from '../src/providers/mock.js';
import type { DeliveryResult, NotificationMessage, Notifier } from '../src/notify/types.js';
import type { LedgerEvent, EventType } from '../src/core/types.js';

/** Captures notifications instead of sending them, so assertions can inspect. */
export class RecordingNotifier implements Notifier {
  readonly channel = 'recording';
  readonly sent: NotificationMessage[] = [];
  /** Set to true to simulate a transport outage. */
  failNext = false;

  isConfigured(): boolean {
    return true;
  }

  async send(message: NotificationMessage): Promise<DeliveryResult[]> {
    if (this.failNext) {
      this.failNext = false;
      return [{ channel: this.channel, target: 'test', ok: false, error: 'simulated outage' }];
    }
    this.sent.push(message);
    return [{ channel: this.channel, target: 'test', ok: true }];
  }
}

export interface Harness {
  config: Config;
  repos: Repositories;
  bank: MockProvider;
  notifier: RecordingNotifier;
  dispatcher: NotificationDispatcher;
  orchestrator: Orchestrator;
  sync: () => Promise<LedgerEvent[]>;
  /** Every ledger event so far, oldest first. */
  events: () => LedgerEvent[];
  eventsOfType: (type: EventType) => LedgerEvent[];
  close: () => void;
}

/**
 * A fully wired system backed by an in-memory database and a simulated bank.
 * `graceHours: 0` makes vanished-pending detection resolve immediately.
 */
export function createHarness(overrides: Record<string, string> = {}): Harness {
  const config = configFrom({
    PROVIDER: 'mock',
    NOTIFY_CHANNELS: 'console',
    PENDING_LIMBO_GRACE_HOURS: '0',
    DATABASE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    ...overrides,
  });

  const db = openTestDatabase();
  const repos = createRepositories(db);
  const bank = new MockProvider();
  const notifier = new RecordingNotifier();
  const dispatcher = new NotificationDispatcher(config, repos, [notifier]);
  const orchestrator = new Orchestrator(config, repos, bank, dispatcher);

  repos.items.upsert({
    itemId: bank.itemId,
    provider: 'mock',
    accessToken: 'test-token',
    institutionName: 'Test Bank',
  });

  return {
    config,
    repos,
    bank,
    notifier,
    dispatcher,
    orchestrator,
    sync: async () => (await orchestrator.syncItem(bank.itemId, 'manual')).events,
    events: () => repos.ledger.query({ limit: 1000, order: 'asc' }),
    eventsOfType: (type) => repos.ledger.query({ limit: 1000, order: 'asc', types: [type] }),
    close: () => db.close(),
  };
}
