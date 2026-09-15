import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Database, Statement } from "bun:sqlite";

import { StoreCheckpointer } from "./checkpoint.js";
import { migrateStore } from "./schema.js";

const STORE_FILE_NAME = "logs.db";
const STORE_LINGER_MS = 30_000;
const STORE_UNSUPPORTED_ERROR = "logger-store-requires-bun";
const STORE_PRAGMAS = [
  "journal_mode = WAL",
  "synchronous = NORMAL",
  "busy_timeout = 5000",
  "temp_store = MEMORY",
  "wal_autocheckpoint = 0",
];

type LogStore = {
  dir: string;
  file: string;
  db: Database;
  checkpointer: StoreCheckpointer;
  statement: (sql: string) => Statement;
  write: <T > (run: () => T) => T;
};

type OpenStoreEntry = {
  store: LogStore;
  refs: number;
  lingerTimer: ReturnType<typeof setTimeout>|null;
};

const openStores = new Map<string, OpenStoreEntry>();
const requireModule = createRequire(import.meta.url);

function loadDatabaseClass(): typeof Database {
  try {
    return (requireModule("bun:sqlite") as typeof import("bun:sqlite")).Database;
  } catch {
    throw new Error(STORE_UNSUPPORTED_ERROR);
  }
}

function isStoreUnsupportedError(error: unknown): boolean {
  return error instanceof Error && error.message === STORE_UNSUPPORTED_ERROR;
}

function storeFileForDir(dir: string): string {
  return path.join(path.resolve(dir), STORE_FILE_NAME);
}

function createDatabase(file: string): Database {
  const DatabaseClass = loadDatabaseClass();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fresh = !fs.existsSync(file);
  const db = new DatabaseClass(file, { create: true, strict: true });
  if (fresh) db.exec("PRAGMA auto_vacuum = INCREMENTAL");
  for (const pragma of STORE_PRAGMAS) db.exec(`PRAGMA ${pragma}`);
  migrateStore(db);
  return db;
}

function createStore(file: string): LogStore {
  const db = createDatabase(file);
  const statements = new Map<string, Statement>();

  return {
    dir: path.dirname(file),
    file,
    db,
    checkpointer: new StoreCheckpointer(file),
    statement(sql) {
      let prepared = statements.get(sql);
      if (!prepared) {
        prepared = db.prepare(sql);
        statements.set(sql, prepared);
      }
      return prepared;
    },
    write(run) {
      return db.transaction(run).immediate();
    },
  };
}

function openStore(dir: string): LogStore {
  const file = storeFileForDir(dir);
  const existing = openStores.get(file);
  if (existing) {
    existing.refs += 1;
    if (existing.lingerTimer) clearTimeout(existing.lingerTimer);
    existing.lingerTimer = null;
    return existing.store;
  }

  const store = createStore(file);
  openStores.set(file, { store, refs: 1, lingerTimer: null });
  return store;
}

function closeStoreEntry(entry: OpenStoreEntry): void {
  if (openStores.get(entry.store.file) !== entry || entry.refs > 0) return;
  openStores.delete(entry.store.file);
  entry.store.checkpointer.close();
  try {
    entry.store.db.close();
  } catch {}
}

function releaseStore(store: LogStore, linger = false): void {
  const entry = openStores.get(store.file);
  if (!entry || entry.store !== store) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  if (!linger) {
    closeStoreEntry(entry);
    return;
  }
  entry.lingerTimer = setTimeout(() => closeStoreEntry(entry), STORE_LINGER_MS);
  if (typeof entry.lingerTimer.unref === "function") entry.lingerTimer.unref();
}

async function withStore<T>(dir: string, run: (store: LogStore) => T | Promise<T>): Promise<T> {
  const store = openStore(dir);
  try {
    return await run(store);
  } finally {
    releaseStore(store, true);
  }
}

function storeExists(dir: string): boolean {
  return fs.existsSync(storeFileForDir(dir));
}

export { isStoreUnsupportedError, openStore, releaseStore, storeExists, storeFileForDir, withStore };
export type { LogStore };
