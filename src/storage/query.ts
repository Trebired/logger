import fs from "node:fs";
import zlib from "node:zlib";

import { normalizeLevels } from "../levels/index.js";
import type { LogEntry, LogQueryOptions, LogQueryResult } from "../types.js";
import { toString } from "../utils/values.js";
import { walkLogFiles } from "./walk.js";

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

function buildQueryResult(dir: string, logs: LogEntry[], options?: LogQueryOptions): LogQueryResult {
  const opts = options || {};
  const limit = Number(opts.limit) || 0;
  return {
    logs,
    levels: normalizeLevels(opts.levels),
    metadata: {
      dir,
      count: logs.length,
      query: {
        level: toString(opts.level || "all").toLowerCase() || "all",
        groupKey: toString(opts.groupKey || "all") || "all",
        day: toString(opts.day),
        hour: toString(opts.hour),
        limit: Number.isFinite(limit) ? limit : 0,
      },
    },
  };
}

async function getEntriesForDir(dir: string, options?: LogQueryOptions): Promise<LogQueryResult> {
  const baseDir = toString(dir);
  if (!baseDir) return buildQueryResult("", [], options);
  const opts = options || {};
  const level = toString(opts.level || "all").toLowerCase() || "all";
  const groupKey = toString(opts.groupKey || "all") || "all";
  const day = toString(opts.day);
  const hour = toString(opts.hour);
  const files = (await walkLogFiles(baseDir)).filter((file) => {
    if (day && file.day !== day) return false;
    if (hour && file.hour !== hour) return false;
    if (groupKey !== "all" && file.groupKey !== groupKey) return false;
    if (level !== "all" && file.level !== level) return false;
    return true;
  });

  let logs: LogEntry[] = [];
  for (const file of files) {
    const rows = await readLogRows(file.absPath, file.compressed);
    for (const row of rows) {
      if (row && !row.group) row.group = file.groupKey;
    }
    logs = logs.concat(rows);
  }

  sortByRecordedAtAsc(logs);

  const limit = Number(opts.limit) || 0;
  const limitedLogs = limit > 0 && Number.isFinite(limit) ? logs.slice(Math.max(0, logs.length - limit)) : logs;
  return buildQueryResult(baseDir, limitedLogs, options);
}

export { buildQueryResult, getEntriesForDir, readLogRows, sortByRecordedAtAsc };
