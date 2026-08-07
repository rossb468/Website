import type { DB } from './index.js';
import { fromJson, fromSqlBool, toJson, toSqlBool } from './index.js';
import type {
  CanonicalAccount,
  CanonicalTransaction,
  EventType,
  FieldChange,
  LedgerEvent,
  NewLedgerEvent,
} from '../core/types.js';

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export interface ItemRow {
  item_id: string;
  provider: string;
  access_token: string;
  institution_id: string | null;
  institution_name: string | null;
  cursor: string | null;
  status: string;
  last_synced_at: string | null;
  last_refresh_at: string | null;
  last_error: string | null;
  consecutive_errors: number;
}

export class ItemRepository {
  constructor(private readonly db: DB) {}

  upsert(input: {
    itemId: string;
    provider: string;
    accessToken: string;
    institutionId?: string | null;
    institutionName?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO items (item_id, provider, access_token, institution_id, institution_name)
         VALUES (@itemId, @provider, @accessToken, @institutionId, @institutionName)
         ON CONFLICT(item_id) DO UPDATE SET
           access_token     = excluded.access_token,
           institution_id   = COALESCE(excluded.institution_id, items.institution_id),
           institution_name = COALESCE(excluded.institution_name, items.institution_name),
           updated_at       = datetime('now')`,
      )
      .run({
        itemId: input.itemId,
        provider: input.provider,
        accessToken: input.accessToken,
        institutionId: input.institutionId ?? null,
        institutionName: input.institutionName ?? null,
      });
  }

  get(itemId: string): ItemRow | undefined {
    return this.db.prepare('SELECT * FROM items WHERE item_id = ?').get(itemId) as ItemRow | undefined;
  }

  listActive(): ItemRow[] {
    return this.db.prepare("SELECT * FROM items WHERE status != 'disabled' ORDER BY created_at").all() as ItemRow[];
  }

  listAll(): ItemRow[] {
    return this.db.prepare('SELECT * FROM items ORDER BY created_at').all() as ItemRow[];
  }

  setCursor(itemId: string, cursor: string): void {
    this.db
      .prepare("UPDATE items SET cursor = ?, last_synced_at = datetime('now'), updated_at = datetime('now') WHERE item_id = ?")
      .run(cursor, itemId);
  }

  markSyncOk(itemId: string): void {
    this.db
      .prepare(
        `UPDATE items
            SET last_synced_at = datetime('now'),
                last_error = NULL,
                consecutive_errors = 0,
                status = CASE WHEN status = 'needs_reauth' THEN 'active' ELSE status END,
                updated_at = datetime('now')
          WHERE item_id = ?`,
      )
      .run(itemId);
  }

  markSyncError(itemId: string, error: string, needsReauth = false): void {
    this.db
      .prepare(
        `UPDATE items
            SET last_error = ?,
                consecutive_errors = consecutive_errors + 1,
                status = CASE WHEN ? = 1 THEN 'needs_reauth' ELSE status END,
                updated_at = datetime('now')
          WHERE item_id = ?`,
      )
      .run(error, needsReauth ? 1 : 0, itemId);
  }

  markRefreshed(itemId: string): void {
    this.db.prepare("UPDATE items SET last_refresh_at = datetime('now') WHERE item_id = ?").run(itemId);
  }

  setStatus(itemId: string, status: 'active' | 'needs_reauth' | 'disabled'): void {
    this.db.prepare("UPDATE items SET status = ?, updated_at = datetime('now') WHERE item_id = ?").run(status, itemId);
  }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface AccountRow {
  account_id: string;
  item_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  currency: string;
  current_balance: number | null;
  available_balance: number | null;
  credit_limit: number | null;
  notify_enabled: number;
  notify_min_amount: number;
}

export class AccountRepository {
  constructor(private readonly db: DB) {}

  get(accountId: string): AccountRow | undefined {
    return this.db.prepare('SELECT * FROM accounts WHERE account_id = ?').get(accountId) as AccountRow | undefined;
  }

  list(): AccountRow[] {
    return this.db.prepare('SELECT * FROM accounts ORDER BY name').all() as AccountRow[];
  }

  listForItem(itemId: string): AccountRow[] {
    return this.db.prepare('SELECT * FROM accounts WHERE item_id = ? ORDER BY name').all(itemId) as AccountRow[];
  }

  /**
   * Insert or update an account, returning the previous balances so the
   * caller can decide whether a `balance.changed` event is warranted.
   */
  upsert(account: CanonicalAccount): { existed: boolean; previous: AccountRow | undefined } {
    const previous = this.get(account.accountId);
    this.db
      .prepare(
        `INSERT INTO accounts (
            account_id, item_id, name, official_name, mask, type, subtype, currency,
            current_balance, available_balance, credit_limit
         ) VALUES (
            @accountId, @itemId, @name, @officialName, @mask, @type, @subtype, @currency,
            @currentBalance, @availableBalance, @creditLimit
         )
         ON CONFLICT(account_id) DO UPDATE SET
           name              = excluded.name,
           official_name     = excluded.official_name,
           mask              = excluded.mask,
           type              = excluded.type,
           subtype           = excluded.subtype,
           currency          = excluded.currency,
           current_balance   = excluded.current_balance,
           available_balance = excluded.available_balance,
           credit_limit      = excluded.credit_limit,
           updated_at        = datetime('now')`,
      )
      .run({
        accountId: account.accountId,
        itemId: account.itemId,
        name: account.name,
        officialName: account.officialName,
        mask: account.mask,
        type: account.type,
        subtype: account.subtype,
        currency: account.currency,
        currentBalance: account.currentBalance,
        availableBalance: account.availableBalance,
        creditLimit: account.creditLimit,
      });
    return { existed: previous !== undefined, previous };
  }

  setNotifyPreferences(accountId: string, opts: { enabled?: boolean; minAmount?: number }): void {
    const current = this.get(accountId);
    if (!current) throw new Error(`Unknown account: ${accountId}`);
    this.db
      .prepare("UPDATE accounts SET notify_enabled = ?, notify_min_amount = ?, updated_at = datetime('now') WHERE account_id = ?")
      .run(
        opts.enabled === undefined ? current.notify_enabled : opts.enabled ? 1 : 0,
        opts.minAmount === undefined ? current.notify_min_amount : Math.abs(Math.round(opts.minAmount)),
        accountId,
      );
  }
}

// ---------------------------------------------------------------------------
// Transactions + versions
// ---------------------------------------------------------------------------

export interface TransactionRow {
  transaction_id: string;
  account_id: string;
  item_id: string;
  lifecycle_id: string;
  amount: number;
  currency: string;
  date: string;
  authorized_date: string | null;
  name: string;
  merchant_name: string | null;
  pending: number;
  pending_transaction_id: string | null;
  category: string | null;
  category_detailed: string | null;
  payment_channel: string | null;
  logo_url: string | null;
  website: string | null;
  raw: string | null;
  state: string;
  first_seen_at: string;
  last_seen_at: string;
}

export type TransactionState = 'present' | 'vanished' | 'superseded' | 'removed';

/** Row -> canonical shape, for diffing against a freshly fetched transaction. */
export function rowToCanonical(row: TransactionRow): CanonicalTransaction {
  return {
    transactionId: row.transaction_id,
    accountId: row.account_id,
    amount: row.amount,
    currency: row.currency,
    date: row.date,
    authorizedDate: row.authorized_date,
    name: row.name,
    merchantName: row.merchant_name,
    pending: row.pending === 1,
    pendingTransactionId: row.pending_transaction_id,
    category: row.category,
    categoryDetailed: row.category_detailed,
    paymentChannel: row.payment_channel,
    logoUrl: row.logo_url,
    website: row.website,
    raw: fromJson(row.raw),
  };
}

export class TransactionRepository {
  constructor(private readonly db: DB) {}

  get(transactionId: string): TransactionRow | undefined {
    return this.db.prepare('SELECT * FROM transactions WHERE transaction_id = ?').get(transactionId) as
      | TransactionRow
      | undefined;
  }

  getCanonical(transactionId: string): CanonicalTransaction | undefined {
    const row = this.get(transactionId);
    return row ? rowToCanonical(row) : undefined;
  }

  /** Every stored record belonging to one purchase, oldest first. */
  listByLifecycle(lifecycleId: string): TransactionRow[] {
    return this.db
      .prepare('SELECT * FROM transactions WHERE lifecycle_id = ? ORDER BY first_seen_at')
      .all(lifecycleId) as TransactionRow[];
  }

  /** Pending transactions still visible in the provider feed. */
  listOpenPending(accountId?: string): TransactionRow[] {
    return accountId
      ? (this.db
          .prepare("SELECT * FROM transactions WHERE pending = 1 AND state = 'present' AND account_id = ?")
          .all(accountId) as TransactionRow[])
      : (this.db.prepare("SELECT * FROM transactions WHERE pending = 1 AND state = 'present'").all() as TransactionRow[]);
  }

  insert(tx: CanonicalTransaction, itemId: string, lifecycleId: string): void {
    this.db
      .prepare(
        `INSERT INTO transactions (
            transaction_id, account_id, item_id, lifecycle_id, amount, currency, date,
            authorized_date, name, merchant_name, pending, pending_transaction_id,
            category, category_detailed, payment_channel, logo_url, website, raw, state
         ) VALUES (
            @transactionId, @accountId, @itemId, @lifecycleId, @amount, @currency, @date,
            @authorizedDate, @name, @merchantName, @pending, @pendingTransactionId,
            @category, @categoryDetailed, @paymentChannel, @logoUrl, @website, @raw, 'present'
         )`,
      )
      .run({
        transactionId: tx.transactionId,
        accountId: tx.accountId,
        itemId,
        lifecycleId,
        amount: tx.amount,
        currency: tx.currency,
        date: tx.date,
        authorizedDate: tx.authorizedDate,
        name: tx.name,
        merchantName: tx.merchantName,
        pending: toSqlBool(tx.pending),
        pendingTransactionId: tx.pendingTransactionId,
        category: tx.category,
        categoryDetailed: tx.categoryDetailed,
        paymentChannel: tx.paymentChannel,
        logoUrl: tx.logoUrl,
        website: tx.website,
        raw: toJson(tx.raw),
      });
  }

  update(tx: CanonicalTransaction): void {
    this.db
      .prepare(
        `UPDATE transactions SET
            amount = @amount, currency = @currency, date = @date,
            authorized_date = @authorizedDate, name = @name, merchant_name = @merchantName,
            pending = @pending, pending_transaction_id = @pendingTransactionId,
            category = @category, category_detailed = @categoryDetailed,
            payment_channel = @paymentChannel, logo_url = @logoUrl, website = @website,
            raw = @raw, last_seen_at = datetime('now'), updated_at = datetime('now')
          WHERE transaction_id = @transactionId`,
      )
      .run({
        transactionId: tx.transactionId,
        amount: tx.amount,
        currency: tx.currency,
        date: tx.date,
        authorizedDate: tx.authorizedDate,
        name: tx.name,
        merchantName: tx.merchantName,
        pending: toSqlBool(tx.pending),
        pendingTransactionId: tx.pendingTransactionId,
        category: tx.category,
        categoryDetailed: tx.categoryDetailed,
        paymentChannel: tx.paymentChannel,
        logoUrl: tx.logoUrl,
        website: tx.website,
        raw: toJson(tx.raw),
      });
  }

  touch(transactionId: string): void {
    this.db.prepare("UPDATE transactions SET last_seen_at = datetime('now') WHERE transaction_id = ?").run(transactionId);
  }

  setState(transactionId: string, state: TransactionState): void {
    this.db
      .prepare("UPDATE transactions SET state = ?, updated_at = datetime('now') WHERE transaction_id = ?")
      .run(state, transactionId);
  }

  /** Re-point a record onto another lifecycle, merging two threads into one. */
  setLifecycle(transactionId: string, lifecycleId: string): void {
    this.db
      .prepare("UPDATE transactions SET lifecycle_id = ?, updated_at = datetime('now') WHERE transaction_id = ?")
      .run(lifecycleId, transactionId);
  }

  /** Append an immutable snapshot. Version numbers are per transaction id. */
  addVersion(tx: CanonicalTransaction, lifecycleId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM transaction_versions WHERE transaction_id = ?')
      .get(tx.transactionId) as { v: number };
    const version = row.v + 1;

    this.db
      .prepare(
        `INSERT INTO transaction_versions (
            transaction_id, lifecycle_id, version, amount, date, name, merchant_name, pending, snapshot
         ) VALUES (@transactionId, @lifecycleId, @version, @amount, @date, @name, @merchantName, @pending, @snapshot)`,
      )
      .run({
        transactionId: tx.transactionId,
        lifecycleId,
        version,
        amount: tx.amount,
        date: tx.date,
        name: tx.name,
        merchantName: tx.merchantName,
        pending: toSqlBool(tx.pending),
        snapshot: JSON.stringify(tx),
      });
    return version;
  }

  listVersions(transactionId: string): Array<{ version: number; observed_at: string; snapshot: CanonicalTransaction }> {
    const rows = this.db
      .prepare('SELECT version, observed_at, snapshot FROM transaction_versions WHERE transaction_id = ? ORDER BY version')
      .all(transactionId) as Array<{ version: number; observed_at: string; snapshot: string }>;
    return rows.map((r) => ({
      version: r.version,
      observed_at: r.observed_at,
      snapshot: JSON.parse(r.snapshot) as CanonicalTransaction,
    }));
  }
}

// ---------------------------------------------------------------------------
// Pending limbo
// ---------------------------------------------------------------------------

export interface LimboRow {
  transaction_id: string;
  account_id: string;
  item_id: string;
  lifecycle_id: string;
  amount: number;
  currency: string;
  date: string;
  name: string;
  merchant_name: string | null;
  snapshot: string;
  removed_at: string;
  resolution: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

export class LimboRepository {
  constructor(private readonly db: DB) {}

  add(tx: CanonicalTransaction, itemId: string, lifecycleId: string): void {
    this.db
      .prepare(
        `INSERT INTO pending_limbo (
            transaction_id, account_id, item_id, lifecycle_id, amount, currency, date, name, merchant_name, snapshot
         ) VALUES (@transactionId, @accountId, @itemId, @lifecycleId, @amount, @currency, @date, @name, @merchantName, @snapshot)
         ON CONFLICT(transaction_id) DO NOTHING`,
      )
      .run({
        transactionId: tx.transactionId,
        accountId: tx.accountId,
        itemId,
        lifecycleId,
        amount: tx.amount,
        currency: tx.currency,
        date: tx.date,
        name: tx.name,
        merchantName: tx.merchantName,
        snapshot: JSON.stringify(tx),
      });
  }

  get(transactionId: string): LimboRow | undefined {
    return this.db.prepare('SELECT * FROM pending_limbo WHERE transaction_id = ?').get(transactionId) as
      | LimboRow
      | undefined;
  }

  /** Unresolved entries, optionally scoped to one account. */
  listOpen(accountId?: string): LimboRow[] {
    return accountId
      ? (this.db
          .prepare('SELECT * FROM pending_limbo WHERE resolution IS NULL AND account_id = ? ORDER BY removed_at')
          .all(accountId) as LimboRow[])
      : (this.db.prepare('SELECT * FROM pending_limbo WHERE resolution IS NULL ORDER BY removed_at').all() as LimboRow[]);
  }

  /** Unresolved entries whose grace period has run out. */
  listExpired(graceHours: number): LimboRow[] {
    return this.db
      .prepare(
        `SELECT * FROM pending_limbo
          WHERE resolution IS NULL
            AND removed_at <= datetime('now', ?)
          ORDER BY removed_at`,
      )
      .all(`-${graceHours} hours`) as LimboRow[];
  }

  resolve(transactionId: string, resolution: 'posted' | 'vanished', resolvedBy?: string): void {
    this.db
      .prepare("UPDATE pending_limbo SET resolution = ?, resolved_at = datetime('now'), resolved_by = ? WHERE transaction_id = ?")
      .run(resolution, resolvedBy ?? null, transactionId);
  }

  snapshotOf(row: LimboRow): CanonicalTransaction {
    return JSON.parse(row.snapshot) as CanonicalTransaction;
  }
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

interface LedgerEventRow {
  id: number;
  observed_at: string;
  type: string;
  item_id: string | null;
  account_id: string | null;
  transaction_id: string | null;
  lifecycle_id: string | null;
  amount: number | null;
  amount_delta: number | null;
  currency: string | null;
  description: string | null;
  pending: number | null;
  changes: string | null;
  metadata: string | null;
  sync_run_id: number | null;
}

function rowToEvent(row: LedgerEventRow): LedgerEvent {
  return {
    id: row.id,
    observedAt: row.observed_at,
    type: row.type as EventType,
    itemId: row.item_id,
    accountId: row.account_id,
    transactionId: row.transaction_id,
    lifecycleId: row.lifecycle_id,
    amount: row.amount,
    amountDelta: row.amount_delta,
    currency: row.currency,
    description: row.description,
    pending: fromSqlBool(row.pending),
    changes: fromJson<FieldChange[]>(row.changes),
    metadata: fromJson<Record<string, unknown>>(row.metadata),
    syncRunId: row.sync_run_id,
  };
}

export interface LedgerQuery {
  accountId?: string;
  itemId?: string;
  lifecycleId?: string;
  types?: EventType[];
  since?: string;
  until?: string;
  limit?: number;
  /** Keyset pagination: return only events with a lower id than this. */
  beforeId?: number;
  order?: 'asc' | 'desc';
}

export class LedgerRepository {
  constructor(private readonly db: DB) {}

  append(event: NewLedgerEvent): LedgerEvent {
    const info = this.db
      .prepare(
        `INSERT INTO ledger_events (
            observed_at, type, item_id, account_id, transaction_id, lifecycle_id,
            amount, amount_delta, currency, description, pending, changes, metadata, sync_run_id
         ) VALUES (
            COALESCE(@observedAt, datetime('now')), @type, @itemId, @accountId, @transactionId, @lifecycleId,
            @amount, @amountDelta, @currency, @description, @pending, @changes, @metadata, @syncRunId
         )`,
      )
      .run({
        observedAt: event.observedAt ?? null,
        type: event.type,
        itemId: event.itemId,
        accountId: event.accountId,
        transactionId: event.transactionId,
        lifecycleId: event.lifecycleId,
        amount: event.amount,
        amountDelta: event.amountDelta,
        currency: event.currency,
        description: event.description,
        pending: toSqlBool(event.pending),
        changes: toJson(event.changes),
        metadata: toJson(event.metadata),
        syncRunId: event.syncRunId,
      });

    return this.byId(Number(info.lastInsertRowid))!;
  }

  byId(id: number): LedgerEvent | undefined {
    const row = this.db.prepare('SELECT * FROM ledger_events WHERE id = ?').get(id) as LedgerEventRow | undefined;
    return row ? rowToEvent(row) : undefined;
  }

  /**
   * The chronological account history. Ordered by `(observed_at, id)` so that
   * several events detected within the same sync pass keep a stable,
   * deterministic order rather than shuffling between queries.
   */
  query(q: LedgerQuery = {}): LedgerEvent[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (q.accountId) {
      where.push('account_id = @accountId');
      params.accountId = q.accountId;
    }
    if (q.itemId) {
      where.push('item_id = @itemId');
      params.itemId = q.itemId;
    }
    if (q.lifecycleId) {
      where.push('lifecycle_id = @lifecycleId');
      params.lifecycleId = q.lifecycleId;
    }
    if (q.types?.length) {
      // Build named placeholders so the list stays parameterised.
      const names = q.types.map((_, i) => `@type${i}`);
      where.push(`type IN (${names.join(', ')})`);
      q.types.forEach((t, i) => {
        params[`type${i}`] = t;
      });
    }
    if (q.since) {
      where.push('observed_at >= @since');
      params.since = q.since;
    }
    if (q.until) {
      where.push('observed_at <= @until');
      params.until = q.until;
    }
    if (q.beforeId !== undefined) {
      where.push('id < @beforeId');
      params.beforeId = q.beforeId;
    }

    const dir = q.order === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
    const sql = `SELECT * FROM ledger_events
                 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY observed_at ${dir}, id ${dir}
                 LIMIT ${limit}`;

    return (this.db.prepare(sql).all(params) as LedgerEventRow[]).map(rowToEvent);
  }

  countByType(since?: string): Record<string, number> {
    const rows = (
      since
        ? this.db.prepare('SELECT type, COUNT(*) AS n FROM ledger_events WHERE observed_at >= ? GROUP BY type').all(since)
        : this.db.prepare('SELECT type, COUNT(*) AS n FROM ledger_events GROUP BY type').all()
    ) as Array<{ type: string; n: number }>;
    return Object.fromEntries(rows.map((r) => [r.type, r.n]));
  }
}

// ---------------------------------------------------------------------------
// Sync runs
// ---------------------------------------------------------------------------

export type SyncTrigger = 'poll' | 'webhook' | 'manual' | 'backfill';

export class SyncRunRepository {
  constructor(private readonly db: DB) {}

  start(itemId: string, trigger: SyncTrigger): number {
    const info = this.db.prepare('INSERT INTO sync_runs (item_id, trigger) VALUES (?, ?)').run(itemId, trigger);
    return Number(info.lastInsertRowid);
  }

  finish(
    id: number,
    result: { ok: boolean; added?: number; modified?: number; removed?: number; events?: number; pages?: number; error?: string },
  ): void {
    this.db
      .prepare(
        `UPDATE sync_runs SET
            finished_at = datetime('now'), ok = @ok, added = @added, modified = @modified,
            removed = @removed, events_emitted = @events, pages = @pages, error = @error
          WHERE id = @id`,
      )
      .run({
        id,
        ok: result.ok ? 1 : 0,
        added: result.added ?? 0,
        modified: result.modified ?? 0,
        removed: result.removed ?? 0,
        events: result.events ?? 0,
        pages: result.pages ?? 0,
        error: result.error ?? null,
      });
  }

  recent(limit = 20): unknown[] {
    return this.db.prepare('SELECT * FROM sync_runs ORDER BY started_at DESC, id DESC LIMIT ?').all(limit);
  }
}

/** Bundle of every repository, sharing one connection. */
export interface Repositories {
  db: DB;
  items: ItemRepository;
  accounts: AccountRepository;
  transactions: TransactionRepository;
  limbo: LimboRepository;
  ledger: LedgerRepository;
  runs: SyncRunRepository;
}

export function createRepositories(db: DB): Repositories {
  return {
    db,
    items: new ItemRepository(db),
    accounts: new AccountRepository(db),
    transactions: new TransactionRepository(db),
    limbo: new LimboRepository(db),
    ledger: new LedgerRepository(db),
    runs: new SyncRunRepository(db),
  };
}
