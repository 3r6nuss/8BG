import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openDatabase(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, '8bg.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS persons (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, birth_date TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      scan_id TEXT REFERENCES scans(id), archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES persons(id),
      person_name TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
      total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
      notes TEXT NOT NULL DEFAULT '', request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(created_by, request_id)
    );
    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY, purchase_id TEXT NOT NULL REFERENCES purchases(id),
      product_id TEXT NOT NULL REFERENCES products(id), product_name TEXT NOT NULL,
      unit_price_cents INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0),
      total_cents INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_purchases_created ON purchases(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
  `);
  return db;
}

export type Database = ReturnType<typeof openDatabase>;

export function transaction<T>(db: Database, operation: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
