import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, 'dashboard.db'));
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS system_samples (
      ts             INTEGER PRIMARY KEY,
      cpu_user       REAL,
      cpu_sys        REAL,
      cpu_idle       REAL,
      load1          REAL,
      mem_used       INTEGER,
      mem_total      INTEGER,
      mem_wired      INTEGER,
      mem_compressed INTEGER,
      net_rx_bps     REAL,
      net_tx_bps     REAL,
      disk_read_mbs  REAL,
      disk_write_mbs REAL,
      disk_used      INTEGER,
      disk_total     INTEGER,
      battery_pct    INTEGER,
      battery_temp_c REAL
    );

    CREATE TABLE IF NOT EXISTS jsonl_cursor (
      path   TEXT PRIMARY KEY,
      size   INTEGER NOT NULL,
      mtime  INTEGER NOT NULL,
      offset INTEGER NOT NULL,
      data   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS http_cache (
      key        TEXT PRIMARY KEY,
      body       TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
  `);
}

/** Read-through cache for outbound HTTP, keyed by request signature. */
export function cacheGet(key: string, ttlMs: number): unknown | null {
  const row = getDb()
    .prepare('SELECT body, fetched_at FROM http_cache WHERE key = ?')
    .get(key) as { body: string; fetched_at: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.fetched_at > ttlMs) return null;
  try {
    return JSON.parse(row.body);
  } catch {
    return null;
  }
}

export function cacheSet(key: string, value: unknown): void {
  getDb()
    .prepare(
      'INSERT INTO http_cache (key, body, fetched_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at',
    )
    .run(key, JSON.stringify(value), Date.now());
}
