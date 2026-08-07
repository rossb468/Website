-- ---------------------------------------------------------------------------
-- finance-tracker schema
--
-- Design notes
--
-- The interesting problem this schema solves is that a bank's transaction
-- history is a *mutable* view of the present, not a record of the past.
-- Pending charges appear and silently disappear; amounts change after the
-- fact when a tip is added or a hold is released; when a pending charge
-- settles most providers delete the pending row and insert a brand new one
-- with a different id. Query the bank tomorrow and yesterday's truth is gone.
--
-- So we keep three layers:
--
--   1. `transactions`         — current known state, one row per provider id.
--   2. `transaction_versions` — immutable snapshot per observed state, so any
--                               past state can be reconstructed exactly.
--   3. `ledger_events`        — append-only, chronological, user-facing log of
--                               every change we detected.
--
-- Plus `pending_limbo`, which holds pending transactions that vanished from
-- the provider until we can decide whether they settled (matched to a posted
-- transaction) or simply evaporated.
-- ---------------------------------------------------------------------------

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- A linked institution connection (Plaid calls this an "Item").
CREATE TABLE IF NOT EXISTS items (
  item_id             TEXT PRIMARY KEY,
  provider            TEXT NOT NULL,
  access_token        TEXT NOT NULL,
  institution_id      TEXT,
  institution_name    TEXT,
  -- Opaque provider cursor marking how far we have consumed the change feed.
  cursor              TEXT,
  status              TEXT NOT NULL DEFAULT 'active',   -- active | needs_reauth | disabled
  last_synced_at      TEXT,
  last_refresh_at     TEXT,
  last_error          TEXT,
  consecutive_errors  INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  account_id        TEXT PRIMARY KEY,
  item_id           TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  official_name     TEXT,
  mask              TEXT,
  type              TEXT,
  subtype           TEXT,
  currency          TEXT NOT NULL DEFAULT 'USD',
  current_balance   INTEGER,          -- minor units
  available_balance INTEGER,
  credit_limit      INTEGER,
  -- Feature 1 opt-in: only accounts flagged here raise push notifications.
  notify_enabled    INTEGER NOT NULL DEFAULT 1,
  -- Suppress noise below this absolute amount, in minor units. 0 = everything.
  notify_min_amount INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_item ON accounts(item_id);

-- Current known state of every transaction, keyed by the provider's id.
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id        TEXT PRIMARY KEY,
  account_id            TEXT NOT NULL,
  item_id               TEXT NOT NULL,
  -- Stable across the pending -> posted id change. Ties a purchase's whole
  -- history together into one thread.
  lifecycle_id          TEXT NOT NULL,
  amount                INTEGER NOT NULL,   -- minor units, negative = outflow
  currency              TEXT NOT NULL DEFAULT 'USD',
  date                  TEXT NOT NULL,
  authorized_date       TEXT,
  name                  TEXT NOT NULL,
  merchant_name         TEXT,
  pending               INTEGER NOT NULL,
  pending_transaction_id TEXT,
  category              TEXT,
  category_detailed     TEXT,
  payment_channel       TEXT,
  logo_url              TEXT,
  website               TEXT,
  raw                   TEXT,             -- provider payload as JSON
  -- present | vanished | superseded | removed
  --   superseded = this pending row settled into a different transaction id
  state                 TEXT NOT NULL DEFAULT 'present',
  first_seen_at         TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_tx_lifecycle ON transactions(lifecycle_id);
CREATE INDEX IF NOT EXISTS idx_tx_pending ON transactions(pending, state);
CREATE INDEX IF NOT EXISTS idx_tx_pending_parent ON transactions(pending_transaction_id);
CREATE INDEX IF NOT EXISTS idx_tx_item ON transactions(item_id);

-- Immutable history. One row per distinct observed state of a transaction,
-- so "what did this look like on Tuesday" is always answerable.
CREATE TABLE IF NOT EXISTS transaction_versions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id  TEXT NOT NULL,
  lifecycle_id    TEXT NOT NULL,
  version         INTEGER NOT NULL,
  observed_at     TEXT NOT NULL DEFAULT (datetime('now')),
  amount          INTEGER NOT NULL,
  date            TEXT NOT NULL,
  name            TEXT NOT NULL,
  merchant_name   TEXT,
  pending         INTEGER NOT NULL,
  -- Full canonical snapshot as JSON, for exact reconstruction.
  snapshot        TEXT NOT NULL,
  UNIQUE (transaction_id, version)
);

CREATE INDEX IF NOT EXISTS idx_versions_tx ON transaction_versions(transaction_id, version);
CREATE INDEX IF NOT EXISTS idx_versions_lifecycle ON transaction_versions(lifecycle_id, observed_at);

-- The user-facing answer to "everything that has happened to my account, in
-- order". Append-only: rows are never updated or deleted.
CREATE TABLE IF NOT EXISTS ledger_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_at     TEXT NOT NULL DEFAULT (datetime('now')),
  type            TEXT NOT NULL,
  item_id         TEXT,
  account_id      TEXT,
  transaction_id  TEXT,
  lifecycle_id    TEXT,
  amount          INTEGER,
  amount_delta    INTEGER,
  currency        TEXT,
  description     TEXT,
  pending         INTEGER,
  changes         TEXT,    -- JSON array of {field, before, after}
  metadata        TEXT,    -- JSON object
  sync_run_id     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_events_time ON ledger_events(observed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_account ON ledger_events(account_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_lifecycle ON ledger_events(lifecycle_id, id);
CREATE INDEX IF NOT EXISTS idx_events_type ON ledger_events(type, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_run ON ledger_events(sync_run_id);

-- Pending transactions that disappeared from the provider feed. They are
-- either about to reappear as a posted transaction (settled) or they never
-- will (vanished). We cannot tell which at the moment of removal, so they
-- wait here until a match arrives or the grace period expires.
CREATE TABLE IF NOT EXISTS pending_limbo (
  transaction_id  TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL,
  item_id         TEXT NOT NULL,
  lifecycle_id    TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  date            TEXT NOT NULL,
  name            TEXT NOT NULL,
  merchant_name   TEXT,
  snapshot        TEXT NOT NULL,
  removed_at      TEXT NOT NULL DEFAULT (datetime('now')),
  -- Set once resolved so we keep an audit trail instead of deleting.
  resolution      TEXT,              -- posted | vanished
  resolved_at     TEXT,
  resolved_by     TEXT               -- transaction_id that settled it
);

CREATE INDEX IF NOT EXISTS idx_limbo_open ON pending_limbo(resolution, removed_at);
CREATE INDEX IF NOT EXISTS idx_limbo_match ON pending_limbo(account_id, resolution, amount);

-- One row per sync pass. Makes it possible to prove the tracker was running
-- and to explain gaps in the ledger.
CREATE TABLE IF NOT EXISTS sync_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id        TEXT NOT NULL,
  trigger        TEXT NOT NULL,      -- poll | webhook | manual | backfill
  started_at     TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at    TEXT,
  ok             INTEGER,
  added          INTEGER NOT NULL DEFAULT 0,
  modified       INTEGER NOT NULL DEFAULT 0,
  removed        INTEGER NOT NULL DEFAULT 0,
  events_emitted INTEGER NOT NULL DEFAULT 0,
  pages          INTEGER NOT NULL DEFAULT 0,
  error          TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_item ON sync_runs(item_id, started_at DESC);

-- Delivery log for feature 1. Doubles as the dedupe table: a unique key per
-- (event, channel, target) makes redelivery impossible even if a sync is
-- replayed or a webhook is delivered twice.
CREATE TABLE IF NOT EXISTS notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL REFERENCES ledger_events(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL,
  target        TEXT NOT NULL DEFAULT '',
  dedupe_key    TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | failed | skipped
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at       TEXT,
  UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_event ON notifications(event_id);

-- Browser/PWA push subscriptions for the webpush channel.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  label       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_ok_at  TEXT,
  failures    INTEGER NOT NULL DEFAULT 0
);
