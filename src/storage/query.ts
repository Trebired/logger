import type { LogQueryOptions, LogQueryResult } from "../types.js";
import { toString } from "../utils/values.js";
import { walkLogFiles } from "./walk.js";
import { normalizePartitionFilter, scopeMatches } from "./query/shared.js";
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
  const allFiles = await walkLogFiles(baseDir);
  const scopeFiles = allFiles.filter((file) => scopeMatches(file, partition, acrossPartitions));
  const allItems = await summarizeFiles(allFiles);
  const scopeItems = scopeFiles === allFiles ? allItems : await summarizeFiles(scopeFiles);
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

export { buildQueryResult, getLogsForDir, readLogRows, sortByRecordedAtAsc };
