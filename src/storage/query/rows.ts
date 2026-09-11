import fs from "node:fs";
import zlib from "node:zlib";
import { createInterface } from "node:readline";

import type { LogEntry } from "#e1h3ay0cyhgl";
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

async function countLogRows(filePath: string, compressed: boolean): Promise<number> {
  if (compressed) {
    try {
      const data = await fs.promises.readFile(filePath);
      return countRowsInText(zlib.gunzipSync(data).toString("utf8"));
    } catch {
      return 0;
    }
  }

  return await new Promise<number>((resolve) => {
      let rows = 0;
      const stream = fs.createReadStream(filePath, { encoding: "utf8" });
      const lines = createInterface({ crlfDelay: Infinity, input: stream });
      lines.on("line", (line) => {
          if (line.trim()) rows += 1;
      });
      lines.on("close", () => resolve(rows));
      lines.on("error", () => resolve(rows));
      stream.on("error", () => resolve(rows));
  });
}

function countRowsInText(text: string): number {
  if (!text.trim()) return 0;
  return text.split("\n").filter((line) => line.trim()).length;
}

function fileStampOrder(file: WalkedLogFile): string {
  return [file.day, file.hour, file.minute, file.second, String(file.sequence).padStart(6, "0")].join("-");
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

export { countLogRows, fileStampOrder, hydrateRows, readLogRows, sortByRecordedAtAsc };
