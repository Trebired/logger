import type {
  DeletePartitionsOptions,
  DeletePartitionsResult,
  FinalizePartitionAction,
  PartitionExistsPolicy,
  PartitionInfo,
  PartitionListResult,
} from "#e1h3ay0cyhgl";
import { createPartitionError } from "./errors.js";
import type { LogStore } from "./open.js";
import { isoOrNull, toEpochMs } from "./rows.js";
import { UNPARTITIONED_ID } from "./schema.js";

const PARTITION_CHUNK_SIZE = 5_000;

type PartitionRow = {
  id: number;
  name: string;
  temporary: number;
  created_at: number;
  first_at: number | null;
  last_at: number | null;
  entry_count: number;
  bytes: number;
};

type FinalizeOutcome = {
  action: FinalizePartitionAction;
  movedEntries: number;
};

const partitionIdCaches = new WeakMap<LogStore, Map<string, number>>();

function partitionCache(store: LogStore): Map<string, number> {
  let cache = partitionIdCaches.get(store);
  if (!cache) {
    cache = new Map<string, number>();
    partitionIdCaches.set(store, cache);
  }
  return cache;
}

function clearPartitionIdCache(store: LogStore): void {
  partitionIdCaches.delete(store);
}

function forgetPartition(store: LogStore, name: string): void {
  partitionCache(store).delete(name);
}

function partitionIdByName(store: LogStore, name: string | null | undefined): number | null {
  if (!name) return UNPARTITIONED_ID;
  const cache = partitionCache(store);
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const row = store.statement("SELECT id FROM partitions WHERE name = ?").get(name) as { id: number } | null;
  if (!row) return null;
  cache.set(name, row.id);
  return row.id;
}

function ensurePartitionId(store: LogStore, name: string | null | undefined, temporary: boolean): number {
  const existing = partitionIdByName(store, name);
  if (existing != null) return existing;
  store
  .statement("INSERT INTO partitions (name, temporary, created_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING")
  .run(name as string, temporary ? 1 : 0, Date.now());
  return partitionIdByName(store, name) as number;
}

function readPartitionRow(store: LogStore, name: string): PartitionRow | null {
  if (!name) return null;
  return store.statement("SELECT * FROM partitions WHERE name = ?").get(name) as PartitionRow | null;
}

function partitionInfoFromRow(row: PartitionRow): PartitionInfo {
  return {
    name: row.name,
    temporary: row.temporary === 1,
    createdAt: new Date(row.created_at).toISOString(),
    firstAt: isoOrNull(row.first_at),
    lastAt: isoOrNull(row.last_at),
    entries: row.entry_count,
    bytes: row.bytes,
  };
}

function getPartitionInfo(store: LogStore, name: string): PartitionInfo | null {
  const row = readPartitionRow(store, name);
  return row ? partitionInfoFromRow(row) : null;
}

function listPartitions(store: LogStore): PartitionListResult {
  const rows = store
  .statement("SELECT * FROM partitions WHERE id != ? ORDER BY created_at ASC, id ASC")
  .all(UNPARTITIONED_ID) as PartitionRow[];
  const items = rows.map(partitionInfoFromRow);
  return {
    items,
    total: {
      partitions: items.length,
      entries: items.reduce((sum, item) => sum + item.entries, 0),
      bytes: items.reduce((sum, item) => sum + item.bytes, 0),
    },
  };
}

function setPartitionTemporary(store: LogStore, name: string, temporary: boolean): void {
  if (!name) return;
  ensurePartitionId(store, name, temporary);
  store.statement("UPDATE partitions SET temporary = ? WHERE name = ?").run(temporary ? 1 : 0, name);
}

function renamePartitionRow(store: LogStore, from: string, to: string, permanent: boolean): void {
  const sql = permanent
  ? "UPDATE partitions SET name = ?, temporary = 0 WHERE name = ?"
  : "UPDATE partitions SET name = ? WHERE name = ?";
  store.write(() => store.statement(sql).run(to, from));
  forgetPartition(store, from);
  forgetPartition(store, to);
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function repeatChunks(store: LogStore, sql: string, params: Array<number>): Promise<number> {
  let total = 0;
  for (;; ) {
    const changes = store.write(() => store.statement(sql).run(...params, PARTITION_CHUNK_SIZE).changes);
    total += changes;
    if (changes < PARTITION_CHUNK_SIZE) return total;
    await yieldToEventLoop();
  }
}

function foldPartitionCounters(store: LogStore, fromId: number, toId: number): void {
  store.write(() => {
      store.statement(`UPDATE partitions SET
        entry_count = entry_count + (SELECT entry_count FROM partitions WHERE id = ?),
        bytes = bytes + (SELECT bytes FROM partitions WHERE id = ?),
        first_at = (SELECT MIN(recorded_at) FROM entries WHERE partition_id = ?),
        last_at = (SELECT MAX(recorded_at) FROM entries WHERE partition_id = ?)
      WHERE id = ?`).run(fromId, fromId, toId, toId, toId);
      store.statement(`INSERT INTO partition_groups (partition_id, group_id, entry_count, last_at)
        SELECT ?, group_id, entry_count, last_at FROM partition_groups WHERE partition_id = ?
        ON CONFLICT (partition_id, group_id) DO UPDATE SET
        entry_count = entry_count + excluded.entry_count,
      last_at = CASE WHEN last_at IS NULL OR last_at < excluded.last_at THEN excluded.last_at ELSE last_at END`)
      .run(toId, fromId);
      store.statement("DELETE FROM partition_groups WHERE partition_id = ?").run(fromId);
      store.statement("DELETE FROM partitions WHERE id = ?").run(fromId);
  });
}

async function deletePartitionById(store: LogStore, partitionId: number): Promise<number> {
  const deleted = await repeatChunks(
    store,
    "DELETE FROM entries WHERE id IN (SELECT id FROM entries WHERE partition_id = ? LIMIT ?)",
    [partitionId],
  );
  store.write(() => {
      store.statement("DELETE FROM partition_groups WHERE partition_id = ?").run(partitionId);
      if (partitionId === UNPARTITIONED_ID) {
        store
        .statement("UPDATE partitions SET entry_count = 0, bytes = 0, first_at = NULL, last_at = NULL WHERE id = ?")
        .run(partitionId);
        return;
      }
      store.statement("DELETE FROM partitions WHERE id = ?").run(partitionId);
  });
  return deleted;
}

async function mergePartitionRows(store: LogStore, source: PartitionRow, target: PartitionRow): Promise<number> {
  const moved = await repeatChunks(
    store,
    "UPDATE entries SET partition_id = ? WHERE id IN (SELECT id FROM entries WHERE partition_id = ? LIMIT ?)",
    [target.id, source.id],
  );
  foldPartitionCounters(store, source.id, target.id);
  forgetPartition(store, source.name);
  return moved;
}

async function finalizeStorePartition(
  store: LogStore,
  from: string,
  to: string,
  ifExists: PartitionExistsPolicy,
): Promise<FinalizeOutcome> {
  const source = readPartitionRow(store, from);
  if (from === to || !source) {
    const wasTemporary = source?.temporary === 1;
    setPartitionTemporary(store, to, false);
    const action = from !== to || !source ? "activated" : wasTemporary ? "marked-permanent" : "already-final";
    return { action, movedEntries: 0 };
  }

  const target = readPartitionRow(store, to);
  if (!target) {
    renamePartitionRow(store, from, to, true);
    return { action: "renamed", movedEntries: source.entry_count };
  }
  if (ifExists === "error") throw createPartitionError("partition-already-exists", { partition: to });
  if (ifExists === "replace") {
    await deletePartitionById(store, target.id);
    forgetPartition(store, to);
    renamePartitionRow(store, from, to, true);
    return { action: "replaced", movedEntries: source.entry_count };
  }

  const movedEntries = await mergePartitionRows(store, source, target);
  setPartitionTemporary(store, to, false);
  return { action: "merged", movedEntries };
}

function selectDeleteCandidates(store: LogStore, options: DeletePartitionsOptions): PartitionRow[] {
  const keep = new Set(options.keep || []);
  const names = Array.isArray(options.names) ? new Set(options.names) : null;
  const olderThan = toEpochMs(options.olderThan);
  const rows = store.statement("SELECT * FROM partitions WHERE id != ?").all(UNPARTITIONED_ID) as PartitionRow[];

  return rows.filter((row) => {
      if (keep.has(row.name)) return false;
      if (names && !names.has(row.name)) return false;
      if (options.temporary === true && row.temporary !== 1) return false;
      if (olderThan != null && (row.last_at ?? row.created_at) >= olderThan) return false;
      return true;
  });
}

async function deletePartitions(store: LogStore, options: DeletePartitionsOptions = {}): Promise<DeletePartitionsResult> {
  const items: string[] = [];
  let entries = 0;
  for (const row of selectDeleteCandidates(store, options)) {
    entries += await deletePartitionById(store, row.id);
    forgetPartition(store, row.name);
    items.push(row.name);
  }
  return { partitions: items.length, entries, items };
}

async function renameStorePartition(
  store: LogStore,
  from: string,
  to: string,
  ifExists: PartitionExistsPolicy,
): Promise<PartitionInfo> {
  const source = readPartitionRow(store, from);
  if (!source) throw createPartitionError("partition-not-found", { partition: from });
  const target = from === to ? null : readPartitionRow(store, to);
  if (!target) {
    if (from !== to) renamePartitionRow(store, from, to, false);
  } else if (ifExists === "error") {
    throw createPartitionError("partition-already-exists", { partition: to });
  } else if (ifExists === "replace") {
    await deletePartitionById(store, target.id);
    forgetPartition(store, to);
    renamePartitionRow(store, from, to, false);
  } else {
    await mergePartitionRows(store, source, target);
  }
  return getPartitionInfo(store, to) as PartitionInfo;
}

export {
  clearPartitionIdCache,
  deletePartitions,
  ensurePartitionId,
  finalizeStorePartition,
  getPartitionInfo,
  listPartitions,
  partitionIdByName,
  renameStorePartition,
  setPartitionTemporary,
  yieldToEventLoop,
};
export type { FinalizeOutcome };
