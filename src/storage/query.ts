import type { LogQueryOptions, LogQueryResult } from "#e1h3ay0cyhgl";
import { toTrimmedString as toString } from "@trebired/utils";
import { getStorageBackend } from "./backend/index.js";
import { walkLogFiles } from "./walk.js";
import { normalizePartitionFilter, partitionKey, scopeMatches, type PartitionSummaryState } from "./query/shared.js";
import type { LogEntry } from "#e1h3ay0cyhgl";
import type { StorageBackend } from "./backend/types.js";
import { readLogRows, sortByRecordedAtAsc } from "./query/rows.js";
import { buildQueryResult, readFilteredLogs, summarizeFiles, totalForItems } from "./query/summary.js";

async function getLogsForDir(dir: string, options?: LogQueryOptions): Promise<LogQueryResult> {
  const baseDir = toString(dir);
  const opts = options || {};
  if (!baseDir) {
    return buildQueryResult("", [], opts, null, false, { logs: 0, dirs: 0, files: 0 }, new Map(), new Map());
  }

  const hasExplicitPartition = Object.prototype.hasOwnProperty.call(opts, "partition");
  const partition = hasExplicitPartition ? normalizePartitionFilter(opts.partition) : null;
  const acrossPartitions = opts.acrossPartitions === true || !hasExplicitPartition;
  const backend = getStorageBackend();
  if (typeof backend.queryLogs === "function") {
    return await nativeQuery(backend.queryLogs, baseDir, opts, partition, acrossPartitions, hasExplicitPartition);
  }

  const allFiles = await walkLogFiles(baseDir);
  const scopeFiles = allFiles.filter((file) => scopeMatches(file, partition, acrossPartitions));
  const allItems = await summarizeFiles(allFiles);
  const scopeItems = scopeFiles.length === allFiles.length ? allItems : await summarizeFiles(scopeFiles);
  const { logs, counts } = await readFilteredLogs(scopeFiles, opts);

  return buildQueryResult(
    baseDir,
    logs,
    opts,
    acrossPartitions ? null : partition,
    hasExplicitPartition,
    totalForItems(scopeItems),
    allItems,
    counts,
  );
}

async function nativeQuery(
  queryLogs: NonNullable<StorageBackend["queryLogs"]>,
  baseDir: string,
  opts: LogQueryOptions,
  partition: string | null,
  acrossPartitions: boolean,
  hasExplicitPartition: boolean,
): Promise<LogQueryResult> {
  const response = await queryLogs({
      acrossPartitions,
      day: toString(opts.day),
      dir: baseDir,
      groupKey: toString(opts.groupKey || "all") || "all",
      hour: toString(opts.hour),
      level: toString(opts.level || "all").toLowerCase() || "all",
      limit: Math.max(0, Number(opts.limit) || 0),
      partition,
  });
  const items = new Map<string, PartitionSummaryState>();
  const counts = new Map<string, number>();

  for (const item of response.items) {
    const key = partitionKey(item.partition);
    items.set(key, { partition: item.partition, total: item.total });
    counts.set(key, item.count);
  }

  return buildQueryResult(
    baseDir,
    response.logs as LogEntry[],
    opts,
    acrossPartitions ? null : partition,
    hasExplicitPartition,
    response.scope,
    items,
    counts,
  );
}

export { buildQueryResult, getLogsForDir, readLogRows, sortByRecordedAtAsc };
