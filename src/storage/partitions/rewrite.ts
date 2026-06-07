import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { PARTITION_MARKER_FILE } from "../../constants.js";
import type { LogEntry } from "../../types.js";
import { makeLogFileName, walkedFileFromPath, type WalkedLogFile } from "../names.js";
import { fileStamp, pathExists, type PartitionRecord } from "./internal.js";

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

async function collectPartitionFilesFromRoot(rootPath: string, partition: string): Promise<WalkedLogFile[]> {
  const out: WalkedLogFile[] = [];
  const stack = [rootPath];

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
      const walked = walkedFileFromPath(rootPath, absPath, partition, rootPath);
      if (walked) out.push(walked);
    }
  }

  return out.sort((a, b) => a.absPath.localeCompare(b.absPath));
}

async function findAvailableTargetPath(dir: string, file: WalkedLogFile): Promise<string> {
  let sequence = Math.max(1, file.sequence);
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

async function rewritePartitionFiles(options: {
  sourceRoot: string;
  sourceName: string;
  targetRoot: string;
  targetName: string;
  merge: boolean;
}): Promise<void> {
  const files = await collectPartitionFilesFromRoot(options.sourceRoot, options.sourceName);

  for (const file of files) {
    const rows = await readLogRows(file.absPath, file.compressed);
    const nextRows = rows.map((row) => ({ ...row, partition: options.targetName }));
    const targetDir = file.groupDir ? path.join(options.targetRoot, file.groupDir) : options.targetRoot;
    await fs.promises.mkdir(targetDir, { recursive: true });
    const targetPath = options.merge
      ? await findAvailableTargetPath(targetDir, file)
      : path.join(targetDir, path.basename(file.absPath));
    await writeLogRows(targetPath, nextRows, file.compressed);
  }
}

async function collectPartitionFiles(record: PartitionRecord): Promise<WalkedLogFile[]> {
  return collectPartitionFilesFromRoot(record.path, record.name);
}

async function writePartitionFiles(source: PartitionRecord, targetRoot: string, targetName: string, merge: boolean): Promise<void> {
  await rewritePartitionFiles({
    sourceRoot: source.path,
    sourceName: source.name,
    targetRoot,
    targetName,
    merge,
  });
}

export {
  collectPartitionFiles,
  collectPartitionFilesFromRoot,
  findAvailableTargetPath,
  readLogRows,
  rewritePartitionFiles,
  writeLogRows,
  writePartitionFiles,
};
