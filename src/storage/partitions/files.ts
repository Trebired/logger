import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { PARTITION_MARKER_FILE } from "../../constants.js";
import type { DeleteLogsOptions, LogEntry } from "../../types.js";
import { normGroup } from "../../groups.js";
import { toString } from "../../utils/values.js";
import { makeLogFileName, walkedFileFromPath, type WalkedLogFile } from "../names.js";
import { fileStamp, pathExists, type PartitionMarker, type PartitionRecord } from "./internal.js";
import { partitionMarkerMap } from "./records.js";

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

async function writeLogRows(filePath: string, rows: LogEntry[], compressed: boolean): Promise<void> {
  const payload = rows.length ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
  if (compressed) {
    const zipped = zlib.gzipSync(Buffer.from(payload, "utf8"));
    await fs.promises.writeFile(filePath, zipped);
    return;
  }
  await fs.promises.writeFile(filePath, payload, "utf8");
}

async function collectPartitionFiles(record: PartitionRecord): Promise<WalkedLogFile[]> {
  const out: WalkedLogFile[] = [];
  const stack = [record.path];

  while (stack.length) {
    const current = stack.pop() || "";
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
        continue;
      }
      if (!entry.isFile() || entry.name === PARTITION_MARKER_FILE) continue;
      const walked = walkedFileFromPath(record.path, absPath, record.name, record.path);
      if (walked) out.push(walked);
    }
  }

  out.sort((a, b) => a.absPath.localeCompare(b.absPath));
  return out;
}

async function findAvailableTargetPath(dir: string, file: WalkedLogFile): Promise<string> {
  let sequence = file.sequence;
  for (;;) {
    const fileName = makeLogFileName(fileStamp(file), sequence, file.level);
    const plainTarget = path.join(dir, fileName);
    const gzipTarget = path.join(dir, `${fileName}.gz`);
    if (!(await pathExists(plainTarget)) && !(await pathExists(gzipTarget))) {
      return file.compressed ? gzipTarget : plainTarget;
    }
    sequence += 1;
  }
}

async function writePartitionFiles(source: PartitionRecord, targetRoot: string, targetName: string, merge: boolean): Promise<void> {
  const files = await collectPartitionFiles(source);

  for (const file of files) {
    const rows = await readLogRows(file.absPath, file.compressed);
    const nextRows = rows.map((row) => ({ ...row, partition: targetName }));
    const targetDir = file.groupDir ? path.join(targetRoot, file.groupDir) : targetRoot;
    await fs.promises.mkdir(targetDir, { recursive: true });
    const targetPath = merge
      ? await findAvailableTargetPath(targetDir, file)
      : path.join(targetDir, path.basename(file.absPath));
    await writeLogRows(targetPath, nextRows, file.compressed);
  }
}

function fileMatchesDeleteFilters(file: WalkedLogFile, options: DeleteLogsOptions): boolean {
  const level = toString(options.level || "all").toLowerCase() || "all";
  const groupKey = toString(options.groupKey || "all") || "all";
  const day = toString(options.day);
  const hour = toString(options.hour);

  if (day && file.day !== day) return false;
  if (hour && file.hour !== hour) return false;
  if (groupKey !== "all" && file.groupKey !== normGroup(groupKey).key) return false;
  if (level !== "all" && file.level !== level) return false;
  return true;
}

async function listTopLevelFiles(baseDir: string): Promise<WalkedLogFile[]> {
  const out: WalkedLogFile[] = [];
  const stack: Array<{ dir: string; rootDir: string; partition: string | null }> = [{ dir: baseDir, rootDir: baseDir, partition: null }];
  const markers = await partitionMarkerMap(baseDir);

  while (stack.length) {
    const current = stack.pop() as { dir: string; rootDir: string; partition: string | null };
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.partition == null && markers.has(entry.name)) {
          stack.push({ dir: absPath, rootDir: absPath, partition: entry.name });
          continue;
        }
        stack.push({ dir: absPath, rootDir: current.rootDir, partition: current.partition });
        continue;
      }
      if (!entry.isFile() || entry.name === PARTITION_MARKER_FILE) continue;
      const walked = walkedFileFromPath(current.rootDir, absPath, current.partition, current.rootDir);
      if (walked) out.push(walked);
    }
  }

  out.sort((a, b) => a.absPath.localeCompare(b.absPath));
  return out;
}

export {
  collectPartitionFiles,
  fileMatchesDeleteFilters,
  findAvailableTargetPath,
  listTopLevelFiles,
  readLogRows,
  writeLogRows,
  writePartitionFiles,
};
