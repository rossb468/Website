import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';

export type DB = Database.Database;

const here = dirname(fileURLToPath(import.meta.url));

function applySchema(db: DB): void {
  const sql = readFileSync(join(here, 'schema.sql'), 'utf8');
  db.exec(sql);
}

/**
 * Open a database and bring it up to date. The schema is written with
 * `IF NOT EXISTS` throughout, so this is safe to run on every start.
 */
export function openDatabase(path?: string): DB {
  const target = path ?? loadConfig().databasePath;

  if (target !== ':memory:') {
    mkdirSync(dirname(target), { recursive: true });
  }

  const db = new Database(target);
  // WAL lets the HTTP server read while a sync pass writes.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Wait rather than immediately throwing SQLITE_BUSY when the poller and an
  // API request collide.
  db.pragma('busy_timeout = 5000');

  applySchema(db);
  logger.debug({ path: target }, 'database ready');
  return db;
}

/** Open an isolated in-memory database. Used by the test suite. */
export function openTestDatabase(): DB {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  return db;
}

let singleton: DB | undefined;

export function getDatabase(): DB {
  singleton ??= openDatabase();
  return singleton;
}

export function closeDatabase(): void {
  singleton?.close();
  singleton = undefined;
}

/**
 * Run `fn` inside a transaction. better-sqlite3 is synchronous, so this is a
 * real all-or-nothing boundary: a sync pass either records all of its events
 * or none of them, and a crash mid-pass can never leave the ledger with a
 * half-applied change.
 */
export function transact<T>(db: DB, fn: () => T): T {
  return db.transaction(fn)();
}

/** SQLite has no boolean type; store 0/1 and convert at the edges. */
export const toSqlBool = (v: boolean | null | undefined): number | null =>
  v === null || v === undefined ? null : v ? 1 : 0;

export const fromSqlBool = (v: number | null | undefined): boolean | null =>
  v === null || v === undefined ? null : v === 1;

export const toJson = (v: unknown): string | null => (v === null || v === undefined ? null : JSON.stringify(v));

export function fromJson<T>(v: string | null | undefined): T | null {
  if (v === null || v === undefined || v === '') return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}
