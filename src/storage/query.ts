import fs from "node:fs";
import zlib from "node:zlib";

import { normalizeLevels } from "../levels/index.js";
import type {
  LogPartitionSummary,
  LogPartitionTotals,
  LogEntry,
  LogQueryOptions,
  LogQueryResult,
  LogQueryTotals,
} from "../types.js";
import { toString } from "../utils/values.js";
import { sanitizePartitionName, type WalkedLogFile } from "./names.js";
import { walkLogFiles } from "./walk.js";

type PartitionSummaryState = {
  partition: string | null;
  total: LogQueryTotals;
};

async function readLogRows(filePath: string, compressed: boolean): Promise<LogEntry[]> {
  try {
    const data = await fs.promises.readFile(filePath);
    const text = compressed ? zlib.gunzipSync(data).toString("utf8") : data.toString("utf8");
    if (!text.trim()) return [];
    const rows: LogEntry[] = [];

    for (const line of text.trim().split("\n")) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object") rows.push(parsed);
      } catch {}
    }

    return rows;
  } catch {
    return [];
  }
}

function sortByRecordedAtAsc(entries: LogEntry[]): LogEntry[] {
  entries.sort((a, b) => {
    const aTime = Date.parse(a && a.recorded_at ? a.recorded_at : "");
    const bTime = Date.parse(b && b.recorded_at ? b.recorded_at : "");
    const av = Number.isFinite(aTime) ? aTime : 0;
    const bv = Number.isFinite(bTime) ? bTime : 0;
    return av - bv;
  });
  return entries;
}

function partitionKey(partition: string | null | undefined): string {
  return partition || "__unpartitioned__";
}

function normalizePartitionFilter(input: unknown): string | null {
  if (input == null) return null;
  const raw = toString(input).trim();
  if (!raw) return null;
  return sanitizePartitionName(raw);
}

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

function fileMatchesFilters(file: WalkedLogFile, options: LogQueryOptions): boolean {
  const level = toString(options.level || "all").toLowerCase() || "all";
  const groupKey = toString(options.groupKey || "all") || "all";
  const day = toString(options.day);
  const hour = toString(options.hour);

  if (day && file.day !== day) return false;
  if (hour && file.hour !== hour) return false;
  if (groupKey !== "all" && file.groupKey !== groupKey) return false;
  if (level !== "all" && file.level !== level) return false;
  return true;
}

function scopeMatches(file: WalkedLogFile, partition: string | null | undefined, acrossPartitions: boolean): boolean {
  if (acrossPartitions) return true;
  if (partition == null) return file.partition == null;
  return file.partition === partition;
}

async function hydrateRows(file: WalkedLogFile): Promise<LogEntry[]> {
  const rows = await readLogRows(file.absPath, file.compressed);
  const fallbackPartition = file.partition || null;

  for (const row of rows) {
    if (row && !row.group) row.group = file.groupKey;
    if (row && !Object.prototype.hasOwnProperty.call(row, "partition")) row.partition = fallbackPartition;
  }

  return rows;
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

async function getLogsForDir(dir: string, options?: LogQueryOptions): Promise<LogQueryResult> {
  const baseDir = toString(dir);
  const opts = options || {};
  if (!baseDir) {
    return buildQueryResult("", [], opts, null, false, { logs: 0, dirs: 0, files: 0 }, new Map(), new Map());
  }

  const hasExplicitPartition = Object.prototype.hasOwnProperty.call(opts, "partition");
  const partition = hasExplicitPartition ? normalizePartitionFilter(opts.partition) : null;
  const acrossPartitions = opts.acrossPartitions === true || !hasExplicitPartition;
  const allFiles = await walkLogFiles(baseDir);
  const scopeFiles = allFiles.filter((file) => scopeMatches(file, partition, acrossPartitions));
  const allItems = await summarizeFiles(allFiles);
  const scopeItems = scopeFiles === allFiles ? allItems : await summarizeFiles(scopeFiles);
  const { logs, counts } = await readFilteredLogs(scopeFiles, opts);

  let total: LogQueryTotals = { logs: 0, dirs: 0, files: 0 };
  for (const item of scopeItems.values()) {
    total.logs += item.total.logs;
    total.dirs += item.total.dirs;
    total.files += item.total.files;
  }

  return buildQueryResult(
    baseDir,
    logs,
    opts,
    acrossPartitions ? null : partition,
    hasExplicitPartition,
    total,
    allItems,
    counts,
  );
}

export { buildQueryResult, getLogsForDir, readLogRows, sortByRecordedAtAsc };
