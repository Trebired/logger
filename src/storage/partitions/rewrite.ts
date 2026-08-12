import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import type { LogEntry } from "#e1h3ay0cyhgl";
import { makeLogFileName, type WalkedLogFile } from "#x2qkmwodgsce";
import { readLogRows } from "#8ky9lhu2jb5d";
import { walkPartitionFiles } from "#o3jnvqp377lh";
import { fileStamp, pathExists, type PartitionRecord } from "./internal.js";

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
  return walkPartitionFiles(rootPath, partition);
}

async function findAvailableTargetPath(dir: string, file: WalkedLogFile): Promise<string> {
  let sequence = Math.max(1, file.sequence);
  for (;; ) {
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
