import type { NormalizedRetentionOptions, RetentionRunResult } from "#e1h3ay0cyhgl";
import type { LogStore } from "./open.js";
import { deletePartitions, yieldToEventLoop } from "./partitions.js";

const RETENTION_CHUNK_SIZE = 5_000;
const VACUUM_PAGES_PER_STEP = 256;
const FIRST_RUN_DELAY_MS = 1_000;

type DeletedRow = {
  id: number;
  partition_id: number;
  group_id: number;
  bytes: number;
};

type RetentionScheduler = {
  start: () => void;
  stop: () => void;
  runNow: () => Promise<RetentionRunResult|null>;
};

const runningByFile = new Map<string, Promise<RetentionRunResult|null>>();

function pragmaNumber(store: LogStore, name: string): number {
  const row = store.db.query(`PRAGMA ${name}`).get() as Record<string, number>|null;
  return row ? Number(Object.values(row)[0]) || 0 : 0;
}

function usedBytes(store: LogStore): number {
  return (pragmaNumber(store, "page_count") - pragmaNumber(store, "freelist_count")) * pragmaNumber(store, "page_size");
}

function decrementCounters(store: LogStore, rows: DeletedRow[]): void {
  const partitions = new Map<number, {count:number;bytes:number}>();
  const groups = new Map<string, {partitionId:number;groupId:number;count:number}>();
  for (const row of rows) {
    const partition = partitions.get(row.partition_id) || { count: 0, bytes: 0 };
    partition.count += 1;
    partition.bytes += Number(row.bytes) || 0;
    partitions.set(row.partition_id, partition);
    const key = `${row.partition_id}:${row.group_id}`;
    const group = groups.get(key) || { partitionId: row.partition_id, groupId: row.group_id, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  const updatePartition = store.statement(`UPDATE partitions SET
    entry_count = MAX(0, entry_count - ?),
    bytes = MAX(0, bytes - ?),
    first_at = (SELECT MIN(recorded_at) FROM entries WHERE partition_id = ?),
    last_at = CASE WHEN entry_count - ? <= 0 THEN NULL ELSE last_at END
  WHERE id = ?`);
  for (const [partitionId, counter] of partitions) {
    updatePartition.run(counter.count, counter.bytes, partitionId, counter.count, partitionId);
  }
  const updateGroup = store.statement(
    "UPDATE partition_groups SET entry_count = MAX(0, entry_count - ?) WHERE partition_id = ? AND group_id = ?",
  );
  for (const counter of groups.values()) updateGroup.run(counter.count, counter.partitionId, counter.groupId);
}

function deleteOldestChunk(store: LogStore, cutoff: number | null): number {
  const where = cutoff == null ? "" : "WHERE recorded_at < ?";
  const params = cutoff == null ? [] : [cutoff];
  return store.write(() => {
      const rows = store.statement(`SELECT id, partition_id, group_id,
        length(message) + IFNULL(length(metadata), 0) AS bytes
      FROM entries ${where} ORDER BY recorded_at ASC, id ASC LIMIT ?`).all(...params, RETENTION_CHUNK_SIZE) as DeletedRow[];
      if (!rows.length) return 0;
      store.statement(`DELETE FROM entries WHERE id IN (
      SELECT id FROM entries ${where} ORDER BY recorded_at ASC, id ASC LIMIT ?)`).run(...params, RETENTION_CHUNK_SIZE);
      decrementCounters(store, rows);
      return rows.length;
  });
}

async function pruneByAge(store: LogStore, maxAgeMs: number): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  let deleted = 0;
  for (;; ) {
    const changes = deleteOldestChunk(store, cutoff);
    deleted += changes;
    if (changes < RETENTION_CHUNK_SIZE) return deleted;
    await yieldToEventLoop();
  }
}

async function pruneBySize(store: LogStore, maxSizeBytes: number): Promise<number> {
  let deleted = 0;
  while (usedBytes(store) > maxSizeBytes) {
    const changes = deleteOldestChunk(store, null);
    deleted += changes;
    if (changes === 0) break;
    await yieldToEventLoop();
  }
  return deleted;
}

async function vacuumFreePages(store: LogStore): Promise<void> {
  let remaining = pragmaNumber(store, "freelist_count");
  while (remaining > 0) {
    store.db.query(`PRAGMA incremental_vacuum(${VACUUM_PAGES_PER_STEP})`).all();
    const next = pragmaNumber(store, "freelist_count");
    if (next >= remaining) return;
    remaining = next;
    await yieldToEventLoop();
  }
}

async function runRetention(
  store: LogStore,
  options: NormalizedRetentionOptions,
  keepTemporary: string[] = [],
): Promise<RetentionRunResult> {
  const bytesBefore = usedBytes(store);
  let deletedEntries = options.maxAgeMs == null ? 0 : await pruneByAge(store, options.maxAgeMs);
  const temporary = await deletePartitions(store, {
      temporary: true,
      olderThan: Date.now() - options.temporaryMaxIdleMs,
      keep: keepTemporary,
  });
  deletedEntries += temporary.entries;
  if (options.maxSizeBytes != null) deletedEntries += await pruneBySize(store, options.maxSizeBytes);
  await vacuumFreePages(store);
  await store.checkpointer.checkpoint("PASSIVE");
  return { deletedEntries, deletedPartitions: temporary.partitions, bytesBefore, bytesAfter: usedBytes(store) };
}

function runRetentionOnce(
  store: LogStore,
  options: NormalizedRetentionOptions,
  keepTemporary: string[],
  onError: (message: string) => void,
): Promise<RetentionRunResult|null> {
  const running = runningByFile.get(store.file);
  if (running) return running;
  const next = runRetention(store, options, keepTemporary)
  .catch ((error) => {
      onError(`log retention failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
  })
  .finally(() => {
      runningByFile.delete(store.file);
  });
  runningByFile.set(store.file, next);
  return next;
}

function createRetentionScheduler(args: {
    getStore: () => LogStore | null;
    options: NormalizedRetentionOptions;
    keepTemporary: () => string[];
    onError: (message: string) => void;
}): RetentionScheduler {
  const timers: Array<ReturnType<typeof setTimeout>> = [];

  function runNow(): Promise<RetentionRunResult|null> {
    let store: LogStore | null = null;
    try {
      store = args.getStore();
    } catch (error) {
      args.onError(`log retention failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!store) return Promise.resolve(null);
    return runRetentionOnce(store, args.options, args.keepTemporary(), args.onError);
  }

  function stop(): void {
    for (const timer of timers.splice(0)) clearTimeout(timer);
  }

  function start(): void {
    stop();
    if (!args.options.enabled) return;
    timers.push(setTimeout(() => void runNow(), FIRST_RUN_DELAY_MS));
    timers.push(setInterval(() => void runNow(), args.options.intervalMs));
    for (const timer of timers) if (typeof timer.unref === "function") timer.unref();
  }

  return { runNow, start, stop };
}

export { createRetentionScheduler, runRetention };
export type { RetentionScheduler };
