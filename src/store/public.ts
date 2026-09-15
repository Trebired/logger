import type {
  DeletePartitionsOptions,
  DeletePartitionsResult,
  ExportLogsOptions,
  ExportLogsResult,
  ListGroupsOptions,
  LogGroupSummary,
  LogQueryOptions,
  LogQueryResult,
  PartitionInfo,
  PartitionListResult,
  RenamePartitionOptions,
  RetentionOptions,
  RetentionRunResult,
  SnapshotStoreOptions,
  SnapshotStoreResult,
} from "#e1h3ay0cyhgl";
import { normalizeLevels } from "#g4tupkl7rvk4";
import { toTrimmedString as toString } from "@trebired/utils";
import { createPartitionError } from "./errors.js";
import { exportStoreLogs, snapshotStore as snapshotOpenStore } from "./export.js";
import { sanitizePartitionName } from "./names.js";
import { storeExists, withStore } from "./open.js";
import { normalizeRetentionOptions } from "./options.js";
import {
  deletePartitions as deleteStorePartitions,
  getPartitionInfo as getStorePartitionInfo,
  listPartitions as listStorePartitions,
  renameStorePartition,
} from "./partitions.js";
import { listStoreGroups, queryStore } from "./query.js";
import { runRetention as runStoreRetention } from "./retention.js";

function requireDir(dir: unknown): string {
  const resolved = toString(dir);
  if (!resolved) throw createPartitionError("missing-log-dir");
  return resolved;
}

async function queryLogs(dir: string, options: LogQueryOptions = {}): Promise<LogQueryResult> {
  const levels = normalizeLevels(options.levels);
  const root = requireDir(dir);
  if (!storeExists(root)) {
    return { entries: [], nextCursor: null, hasMore: false, total: options.count ? 0 : null, levels };
  }
  return withStore(root, (store) => queryStore(store, options, levels));
}

async function listGroups(dir: string, options: ListGroupsOptions = {}): Promise<LogGroupSummary[]> {
  const root = requireDir(dir);
  if (!storeExists(root)) return [];
  return withStore(root, (store) => listStoreGroups(store, options));
}

async function getPartitionInfo(dir: string, partition: string): Promise<PartitionInfo|null> {
  const root = requireDir(dir);
  if (!storeExists(root)) return null;
  return withStore(root, (store) => getStorePartitionInfo(store, sanitizePartitionName(partition)));
}

async function listPartitions(dir: string): Promise<PartitionListResult> {
  const root = requireDir(dir);
  if (!storeExists(root)) return { items: [], total: { partitions: 0, entries: 0, bytes: 0 } };
  return withStore(root, (store) => listStorePartitions(store));
}

async function renamePartition(dir: string, options: RenamePartitionOptions): Promise<PartitionInfo> {
  const root = requireDir(dir);
  const from = sanitizePartitionName(options.from);
  if (!storeExists(root)) throw createPartitionError("partition-not-found", { partition: from });
  const to = sanitizePartitionName(options.to);
  return withStore(root, (store) => renameStorePartition(store, from, to, options.ifExists || "error"));
}

async function deletePartitions(dir: string, options: DeletePartitionsOptions = {}): Promise<DeletePartitionsResult> {
  const root = requireDir(dir);
  if (!storeExists(root)) return { partitions: 0, entries: 0, items: [] };
  return withStore(root, (store) => deleteStorePartitions(store, options));
}

async function exportLogs(dir: string, options: ExportLogsOptions): Promise<ExportLogsResult> {
  const root = requireDir(dir);
  const levels = normalizeLevels(options.levels);
  return withStore(root, (store) => exportStoreLogs(store, options, levels));
}

async function snapshotStore(dir: string, options: SnapshotStoreOptions): Promise<SnapshotStoreResult> {
  const root = requireDir(dir);
  return withStore(root, (store) => snapshotOpenStore(store, options));
}

async function runRetention(dir: string, options?: RetentionOptions): Promise<RetentionRunResult|null> {
  const root = requireDir(dir);
  if (!storeExists(root)) return null;
  return withStore(root, (store) => runStoreRetention(store, normalizeRetentionOptions(options)));
}

export {
  deletePartitions,
  exportLogs,
  getPartitionInfo,
  listGroups,
  listPartitions,
  queryLogs,
  renamePartition,
  runRetention,
  snapshotStore,
};
