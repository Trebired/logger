import type { Database } from "bun:sqlite";

const SCHEMA_VERSION = 1;
const UNPARTITIONED_ID = 0;

const SCHEMA_V1 = [
  `CREATE TABLE IF NOT EXISTS partitions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  temporary INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  first_at INTEGER,
  last_at INTEGER,
  entry_count INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS partition_groups (
  partition_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  entry_count INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER,
  PRIMARY KEY (partition_id, group_id)
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY,
  partition_id INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  level TEXT NOT NULL,
  group_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  instance TEXT,
  message TEXT NOT NULL,
  metadata TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS entries_partition_time ON entries (partition_id, recorded_at)",
  "CREATE INDEX IF NOT EXISTS entries_partition_group_time ON entries (partition_id, group_id, recorded_at)",
  "CREATE INDEX IF NOT EXISTS entries_partition_level_time ON entries (partition_id, level, recorded_at)",
  "CREATE INDEX IF NOT EXISTS entries_time ON entries (recorded_at)",
];

function readUserVersion(db: Database): number {
  const row = db.query("PRAGMA user_version").get() as { user_version?: number } | null;
  return Number(row?.user_version) || 0;
}

function migrateStore(db: Database): void {
  const version = readUserVersion(db);
  if (version > SCHEMA_VERSION) throw new Error("logger-store-newer-than-package");
  if (version === SCHEMA_VERSION) return;

  db.transaction(() => {
      for (const sql of SCHEMA_V1) db.exec(sql);
      db.query("INSERT OR IGNORE INTO partitions (id, name, temporary, created_at) VALUES (?, '', 0, ?)")
      .run(UNPARTITIONED_ID, Date.now());
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }).immediate();
}

export { migrateStore, SCHEMA_VERSION, UNPARTITIONED_ID };
