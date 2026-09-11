import { normalizeLevels } from "#g4tupkl7rvk4";
import type {
  LogPartitionSummary,
  LogPartitionTotals,
  LogEntry,
  LogQueryOptions,
  LogQueryResult,
  LogQueryTotals,
} from "#e1h3ay0cyhgl";
import { toTrimmedString as toString } from "@trebired/utils";
import type { WalkedLogFile } from "#x2qkmwodgsce";
import { fileMatchesFilters, partitionKey, type PartitionSummaryState } from "./shared.js";
import { countLogRows, fileStampKey, fileStampOrder, hydrateRows, sortByRecordedAtAsc } from "./rows.js";

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
    const rows = await countLogRows(file.absPath, file.compressed);
    const current = items.get(key) || {
      partition: file.partition || null,
      total: { logs: 0, dirs: 0, files: 0 },
    };

    current.total.logs += rows;
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

async function readFilteredLogs(files: WalkedLogFile[], options: LogQueryOptions): Promise<{logs:LogEntry[];counts:Map<string, number>}> {
  const limit = Number(options.limit) || 0;
  const bounded = limit > 0 && Number.isFinite(limit);
  const ascending = files
  .filter((file) => fileMatchesFilters(file, options))
  .sort((left, right) => {
      return fileStampOrder(left).localeCompare(fileStampOrder(right)) || left.absPath.localeCompare(right.absPath);
  });
  const counts = new Map<string, number>();

  if (!bounded) return { counts, logs: await readAllRows(ascending, counts) };
  return { counts, logs: await readNewestRows(ascending, counts, limit) };
}

async function readAllRows(files: WalkedLogFile[], counts: Map<string, number>): Promise<LogEntry[]> {
  let logs: LogEntry[] = [];

  for (const file of files) {
    const rows = await hydrateRows(file);
    const key = partitionKey(file.partition);
    counts.set(key, (counts.get(key) || 0) + rows.length);
    logs = logs.concat(rows);
  }

  sortByRecordedAtAsc(logs);
  return logs;
}

async function readNewestRows(files: WalkedLogFile[], counts: Map<string, number>, limit: number): Promise<LogEntry[]> {
  const selected: LogEntry[][] = [];
  let collected = 0;

  let lastStamp = "";

  for (let index = files.length - 1; index >= 0; index -= 1) {
    const file = files[index];
    const key = partitionKey(file.partition);
    if (collected >= limit && fileStampKey(file) !== lastStamp) {
      counts.set(key, (counts.get(key) || 0) + (await countLogRows(file.absPath, file.compressed)));
      continue;
    }
    const rows = await hydrateRows(file);
    counts.set(key, (counts.get(key) || 0) + rows.length);
    collected += rows.length;
    lastStamp = fileStampKey(file);
    selected.unshift(rows);
  }

  let logs: LogEntry[] = [];
  for (const rows of selected) logs = logs.concat(rows);
  sortByRecordedAtAsc(logs);
  return logs.slice(Math.max(0, logs.length - limit));
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
