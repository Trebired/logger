import type { LogStore } from "./open.js";

const groupIdCaches = new WeakMap<LogStore, Map<string, number>>();

function groupCache(store: LogStore): Map<string, number> {
  let cache = groupIdCaches.get(store);
  if (!cache) {
    cache = new Map<string, number>();
    groupIdCaches.set(store, cache);
  }
  return cache;
}

function clearGroupIdCache(store: LogStore): void {
  groupIdCaches.delete(store);
}

function groupIdFor(store: LogStore, key: string): number {
  const cache = groupCache(store);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  store.statement("INSERT OR IGNORE INTO groups (key) VALUES (?)").run(key);
  const row = store.statement("SELECT id FROM groups WHERE key = ?").get(key) as { id: number };
  cache.set(key, row.id);
  return row.id;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

function groupIdsForPrefix(store: LogStore, prefix: string): number[] {
  const rows = store
  .statement("SELECT id FROM groups WHERE key = ? OR key LIKE ? ESCAPE '\\'")
  .all(prefix, `${escapeLikePattern(prefix)}.%`) as Array<{id:number}>;
  return rows.map((row) => row.id);
}

export { clearGroupIdCache, escapeLikePattern, groupIdFor, groupIdsForPrefix };
