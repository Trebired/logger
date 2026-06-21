import fs from "node:fs";
import zlib from "node:zlib";

import type { LogEntry } from "#tvzweoxg5ahk";
import type { WalkedLogFile } from "#x2qkmwodgsce";

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

async function hydrateRows(file: WalkedLogFile): Promise<LogEntry[]> {
  const rows = await readLogRows(file.absPath, file.compressed);
  const fallbackPartition = file.partition || null;

  for (const row of rows) {
    if (row && !row.group) row.group = file.groupKey;
    if (row && !Object.prototype.hasOwnProperty.call(row, "partition")) row.partition = fallbackPartition;
  }

  return rows;
}

export { hydrateRows, readLogRows, sortByRecordedAtAsc };
