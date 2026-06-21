import { normalizeLevels } from "#g4tupkl7rvk4";
import type {
  LogPartitionSummary,
  LogPartitionTotals,
  LogEntry,
  LogQueryOptions,
  LogQueryResult,
  LogQueryTotals,
} from "#tvzweoxg5ahk";
import { toString } from "#ycytzc4gr3f7";
import type { WalkedLogFile } from "#x2qkmwodgsce";
import { fileMatchesFilters, partitionKey, type PartitionSummaryState } from "./shared.js";
import { hydrateRows, sortByRecordedAtAsc } from "./rows.js";

function buildAggregateTotals(items: Map<string, PartitionSummaryState>): LogPartitionTotals {
  let logs = 0;
  let dirs = 0;
  let files = 0;

  for (const item of items.values()) {
    logs += item.total.logs;
    dirs += item.total.dirs;
    files += item.total.files;
  }

  return {
    logs,
    dirs,
    files,
    partitions: items.size,
  };
}

function buildPartitionItems(items: Map<string, PartitionSummaryState>, counts: Map<string, number>): LogPartitionSummary[] {
  return Array.from(items.values())
    .sort((a, b) => (a.partition || "").localeCompare(b.partition || ""))
    .map((item) => ({
      partition: item.partition,
      count: counts.get(partitionKey(item.partition)) || 0,
      total: item.total,
    }));
}

function buildQueryResult(
  dir: string,
  logs: LogEntry[],
  options: LogQueryOptions | undefined,
  partition: string | null,
  hasExplicitPartition: boolean,
  total: LogQueryTotals,
  items: Map<string, PartitionSummaryState>,
  counts: Map<string, number>,
): LogQueryResult {
  const opts = options || {};
  const limit = Number(opts.limit) || 0;
  const acrossPartitions = opts.acrossPartitions === true || !hasExplicitPartition;

  return {
    logs,
    levels: normalizeLevels(opts.levels),
    metadata: {
      dir,
      partition,
      count: logs.length,
      total,
      query: {
        level: toString(opts.level || "all").toLowerCase() || "all",
        groupKey: toString(opts.groupKey || "all") || "all",
        day: toString(opts.day),
        hour: toString(opts.hour),
        limit: Number.isFinite(limit) ? limit : 0,
        partition: hasExplicitPartition ? partition : null,
        acrossPartitions,
      },
      partitions: {
        items: buildPartitionItems(items, counts),
        all: buildAggregateTotals(items),
      },
    },
  };
}

async function summarizeFiles(files: WalkedLogFile[]): Promise<Map<string, PartitionSummaryState>> {
  const items = new Map<string, PartitionSummaryState>();
  const dirSets = new Map<string, Set<string>>();

  for (const file of files) {
    const key = partitionKey(file.partition);
    const rows = await hydrateRows(file);
    const current = items.get(key) || {
      partition: file.partition || null,
      total: { logs: 0, dirs: 0, files: 0 },
    };

    current.total.logs += rows.length;
    current.total.files += 1;
    items.set(key, current);

    const dirs = dirSets.get(key) || new Set<string>();
    dirs.add(file.relDir || ".");
    dirSets.set(key, dirs);
  }

  for (const [key, dirs] of dirSets.entries()) {
    const item = items.get(key);
    if (item) item.total.dirs = dirs.size;
  }

  return items;
}

async function readFilteredLogs(files: WalkedLogFile[], options: LogQueryOptions): Promise<{ logs: LogEntry[]; counts: Map<string, number> }> {
  let logs: LogEntry[] = [];
  const counts = new Map<string, number>();

  for (const file of files) {
    if (!fileMatchesFilters(file, options)) continue;
    const rows = await hydrateRows(file);
    const key = partitionKey(file.partition);
    counts.set(key, (counts.get(key) || 0) + rows.length);
    logs = logs.concat(rows);
  }

  sortByRecordedAtAsc(logs);

  const limit = Number(options.limit) || 0;
  const limitedLogs = limit > 0 && Number.isFinite(limit) ? logs.slice(Math.max(0, logs.length - limit)) : logs;
  return { logs: limitedLogs, counts };
}

function totalForItems(items: Map<string, PartitionSummaryState>): LogQueryTotals {
  let total: LogQueryTotals = { logs: 0, dirs: 0, files: 0 };
  for (const item of items.values()) {
    total.logs += item.total.logs;
    total.dirs += item.total.dirs;
    total.files += item.total.files;
  }
  return total;
}

export { buildQueryResult, readFilteredLogs, summarizeFiles, totalForItems };
