import type { LogEntry, LogStats, NormalizedWriteOptions } from "#e1h3ay0cyhgl";
import { toTrimmedString as toString } from "@trebired/utils";
import { clearGroupIdCache, groupIdFor } from "./groups.js";
import { isStoreUnsupportedError, openStore, releaseStore, type LogStore } from "./open.js";
import { clearPartitionIdCache, ensurePartitionId } from "./partitions.js";
import { serializeMetadata, toEpochMs } from "./rows.js";

type PendingEntry = {
  entry: LogEntry;
  temporary: boolean;
};

type PartitionCounter = {
  count: number;
  bytes: number;
  firstAt: number;
  lastAt: number;
};

type GroupCounter = {
  partitionId: number;
  groupId: number;
  count: number;
  lastAt: number;
};

type BatchState = {
  partitions: Map<number, PartitionCounter>;
  groups: Map<number, GroupCounter>;
  groupIds: Map<string, number>;
  partitionName: string | null | undefined;
  partitionId: number;
};

type StoreWriterOptions = {
  dir: string;
  save: boolean;
  write: NormalizedWriteOptions;
  onError?: (message: string) => void;
};

const ROWS_PER_STATEMENT = 50;
const ENTRY_COLUMNS_PER_ROW = 8;
const ENTRY_ROW_PLACEHOLDERS = "(?, ?, ?, ?, ?, ?, ?, ?)";
const GROUP_KEY_FACTOR = 2 ** 26;

const UPDATE_PARTITION_SQL = `UPDATE partitions SET
entry_count = entry_count + ?,
bytes = bytes + ?,
first_at = CASE WHEN first_at IS NULL OR first_at > ? THEN ? ELSE first_at END,
last_at = CASE WHEN last_at IS NULL OR last_at < ? THEN ? ELSE last_at END
WHERE id = ?`;

const UPSERT_GROUP_SQL = `INSERT INTO partition_groups (partition_id, group_id, entry_count, last_at)
VALUES (?, ?, ?, ?)
ON CONFLICT (partition_id, group_id) DO UPDATE SET
entry_count = entry_count + excluded.entry_count,
last_at = CASE WHEN last_at IS NULL OR last_at < excluded.last_at THEN excluded.last_at ELSE last_at END`;

function insertEntriesSql(rows: number): string {
  const values = new Array(rows).fill(ENTRY_ROW_PLACEHOLDERS).join(", ");
  return `INSERT INTO entries (partition_id, recorded_at, level, group_id, source, instance, message, metadata) VALUES ${values}`;
}

const FULL_INSERT_SQL = insertEntriesSql(ROWS_PER_STATEMENT);

function createBatchState(): BatchState {
  return { partitions: new Map(), groups: new Map(), groupIds: new Map(), partitionName: undefined, partitionId: 0 };
}

function countPartition(state: BatchState, partitionId: number, recordedAt: number, bytes: number): void {
  const current = state.partitions.get(partitionId);
  if (!current) {
    state.partitions.set(partitionId, { count: 1, bytes, firstAt: recordedAt, lastAt: recordedAt });
    return;
  }
  current.count += 1;
  current.bytes += bytes;
  if (recordedAt < current.firstAt) current.firstAt = recordedAt;
  if (recordedAt > current.lastAt) current.lastAt = recordedAt;
}

function countGroup(state: BatchState, partitionId: number, groupId: number, recordedAt: number): void {
  const key = partitionId * GROUP_KEY_FACTOR + groupId;
  const current = state.groups.get(key);
  if (!current) {
    state.groups.set(key, { partitionId, groupId, count: 1, lastAt: recordedAt });
    return;
  }
  current.count += 1;
  if (recordedAt > current.lastAt) current.lastAt = recordedAt;
}

function batchPartitionId(store: LogStore, item: PendingEntry, state: BatchState): number {
  const name = item.entry.partition ?? null;
  if (state.partitionName === name) return state.partitionId;
  state.partitionName = name;
  state.partitionId = ensurePartitionId(store, name, item.temporary);
  return state.partitionId;
}

function batchGroupId(store: LogStore, group: string, state: BatchState): number {
  const cached = state.groupIds.get(group);
  if (cached !== undefined) return cached;
  const groupId = groupIdFor(store, group);
  state.groupIds.set(group, groupId);
  return groupId;
}

function appendEntryRow(store: LogStore, item: PendingEntry, params: unknown[], state: BatchState): void {
  const { entry } = item;
  const partitionId = batchPartitionId(store, item, state);
  const groupId = batchGroupId(store, entry.group, state);
  const recordedAt = toEpochMs(entry.recorded_at) ?? Date.now();
  const metadata = serializeMetadata(entry.metadata);
  const origin = entry.origin;
  const source = origin && typeof origin.source === "string" && origin.source ? origin.source : "app";
  params.push(partitionId, recordedAt, entry.level, groupId, source, origin?.instance ?? null, entry.message, metadata);
  countPartition(state, partitionId, recordedAt, entry.message.length + (metadata ? metadata.length : 0));
  countGroup(state, partitionId, groupId, recordedAt);
}

function insertEntryRows(store: LogStore, batch: PendingEntry[], state: BatchState): void {
  const fullStatement = store.statement(FULL_INSERT_SQL);
  let params: unknown[] = [];
  for (const item of batch) {
    appendEntryRow(store, item, params, state);
    if (params.length === ROWS_PER_STATEMENT * ENTRY_COLUMNS_PER_ROW) {
      fullStatement.run(...(params as any[]));
      params = [];
    }
  }
  const remainingRows = params.length / ENTRY_COLUMNS_PER_ROW;
  if (remainingRows > 0) store.statement(insertEntriesSql(remainingRows)).run(...(params as any[]));
}

function applyCounters(store: LogStore, state: BatchState): void {
  const updatePartition = store.statement(UPDATE_PARTITION_SQL);
  for (const [partitionId, counter] of state.partitions) {
    updatePartition.run(
      counter.count,
      counter.bytes,
      counter.firstAt,
      counter.firstAt,
      counter.lastAt,
      counter.lastAt,
      partitionId,
    );
  }
  const upsertGroup = store.statement(UPSERT_GROUP_SQL);
  for (const counter of state.groups.values()) {
    upsertGroup.run(counter.partitionId, counter.groupId, counter.count, counter.lastAt);
  }
}

function insertBatch(store: LogStore, batch: PendingEntry[]): void {
  const state = createBatchState();
  store.write(() => {
      insertEntryRows(store, batch, state);
      applyCounters(store, state);
  });
}

class StoreWriter {
  private dir: string;
  private save: boolean;
  private options: NormalizedWriteOptions;
  private store: LogStore | null = null;
  private queue: PendingEntry[] = [];
  private timer: ReturnType<typeof setTimeout>|null = null;
  private closed = false;
  private onError?: (message: string) => void;
  private stats: LogStats;

  constructor(options: StoreWriterOptions) {
    this.dir = toString(options.dir);
    this.save = Boolean(options.save);
    this.options = options.write;
    this.onError = options.onError;
    this.stats = {
      mode: this.options.mode,
      queued: 0,
      written: 0,
      dropped: 0,
      failed: 0,
      batches: 0,
      queueLength: 0,
      closed: false,
    };
  }

  getDir(): string {
    return this.dir;
  }

  isSavingEnabled(): boolean {
    return this.save && Boolean(this.dir);
  }

  getStats(): LogStats {
    return { ...this.stats, queueLength: this.queue.length, closed: this.closed };
  }

  getStore(): LogStore | null {
    if (!this.isSavingEnabled() || this.closed) return null;
    if (!this.store) this.store = this.openOwnStore();
    return this.store;
  }

  setDir(nextDir: string): void {
    this.drain();
    this.releaseCurrent();
    this.dir = toString(nextDir);
    if (this.dir) this.save = true;
  }

  write(entry: LogEntry, temporary: boolean): void {
    if (!this.isSavingEnabled()) return;
    if (this.closed) {
      this.stats.dropped += 1;
      return;
    }
    if (this.options.mode === "sync") {
      this.writeBatch([{ entry, temporary }]);
      return;
    }
    if (!this.acceptIntoQueue()) return;
    this.queue.push({ entry, temporary });
    this.stats.queued += 1;
    this.schedule();
  }

  flush(): Promise<void> {
    this.drain();
    return Promise.resolve();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.drain();
    this.closed = true;
    this.releaseCurrent();
  }

  private openOwnStore(): LogStore | null {
    try {
      return openStore(this.dir);
    } catch (error) {
      if (!isStoreUnsupportedError(error)) throw error;
      this.save = false;
      if (this.onError) this.onError("log saving is off: saving logs to a directory requires the Bun runtime");
      return null;
    }
  }

  private acceptIntoQueue(): boolean {
    if (this.queue.length < this.options.maxQueue) return true;
    if (this.options.overflow === "throw") throw new Error("logger-write-queue-full");
    this.stats.dropped += 1;
    if (this.options.overflow === "drop-newest") return false;
    this.queue.shift();
    return true;
  }

  private schedule(): void {
    if (this.queue.length >= this.options.batchSize) {
      this.drain();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, this.options.flushIntervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  private drain(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.queue.length) {
      this.writeBatch(this.queue.splice(0, this.options.batchSize));
    }
  }

  private writeBatch(batch: PendingEntry[]): void {
    const store = this.getStore();
    if (!store) {
      this.stats.dropped += batch.length;
      return;
    }
    try {
      insertBatch(store, batch);
      store.checkpointer.noteWrite();
      this.stats.written += batch.length;
      this.stats.batches += 1;
    } catch (error) {
      clearGroupIdCache(store);
      clearPartitionIdCache(store);
      this.stats.failed += batch.length;
      if (this.onError) this.onError(`log store write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private releaseCurrent(): void {
    if (!this.store) return;
    releaseStore(this.store);
    this.store = null;
  }
}

export { StoreWriter };
export type { StoreWriterOptions };
