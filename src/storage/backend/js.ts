import fs from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";
import zlib from "node:zlib";

import { zipSync, strToU8 } from "fflate";
import tar from "tar-stream";

import { PARTITION_MARKER_FILE } from "#cuh2x5snaefd";
import { bytesToMegabytes } from "#unnkpg8o07bp";
import { walkedFileFromPath, type WalkedLogFile } from "#x2qkmwodgsce";
import { readPartitionMarkerFromRoot } from "#60bftlbj9ito";
import { resolveDir } from "#08atyj8ixt0i";
import { rewritePartitionFiles as rewritePartitionFilesToTarget } from "#nal3wuve8edd";
import type { ArchiveCreateInput, StorageBackend, StorageScanFile, StorageScanPartition, StorageScanSnapshot } from "./types.js";

function countRows(text: string): number {
  if (!text.trim()) return 0;
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .length;
}

async function countRowsInFile(filePath: string, compressed: boolean): Promise<number> {
  const data = await fs.promises.readFile(filePath);
  const text = compressed ? zlib.gunzipSync(data).toString("utf8") : data.toString("utf8");
  return countRows(text);
}

async function collectPartitionFiles(baseDir: string, partition: string): Promise<WalkedLogFile[]> {
  const rootDir = path.join(baseDir, partition);
  const out: WalkedLogFile[] = [];
  const stack = [rootDir];

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
      const walked = walkedFileFromPath(rootDir, absPath, partition, rootDir);
      if (walked) out.push(walked);
    }
  }

  return out.sort((a, b) => a.absPath.localeCompare(b.absPath));
}

async function scanPartition(baseDir: string, partition: string): Promise<{ files: StorageScanFile[]; item: StorageScanPartition }> {
  const rootDir = path.join(baseDir, partition);
  const marker = await readPartitionMarkerFromRoot(rootDir, partition);
  if (!marker) throw new Error(`partition-not-found: ${partition}`);

  const walked = await collectPartitionFiles(baseDir, partition);
  const files: StorageScanFile[] = [];
  const dirs = new Set<string>();
  const summary = await collectScannedPartitionFiles(files, dirs, walked, partition);

  return {
    files,
    item: {
      name: partition,
      total: {
        logs: summary.logs,
        dirs: dirs.size,
        files: files.length,
        bytes: summary.bytes,
        megabytes: bytesToMegabytes(summary.bytes),
      },
      lastActivityAt: summary.lastActivityMs > 0 ? new Date(summary.lastActivityMs).toISOString() : null,
    },
  };
}

async function collectScannedPartitionFiles(
  files: StorageScanFile[],
  dirs: Set<string>,
  walked: WalkedLogFile[],
  partition: string,
): Promise<{ bytes: number; logs: number; lastActivityMs: number }> {
  let bytes = 0;
  let logs = 0;
  let lastActivityMs = 0;

  for (const file of walked) {
    const scanned = await scanPartitionFile(file, partition);
    if (!scanned) {
      continue;
    }

    files.push(scanned.file);
    dirs.add(file.groupDir || ".");
    bytes += scanned.file.bytes;
    logs += scanned.file.rows;
    if (scanned.lastActivityMs > lastActivityMs) lastActivityMs = scanned.lastActivityMs;
  }

  return {
    bytes,
    logs,
    lastActivityMs,
  };
}

async function scanPartitionFile(
  file: WalkedLogFile,
  partition: string,
): Promise<{ file: StorageScanFile; lastActivityMs: number } | null> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(file.absPath);
  } catch {
    return null;
  }

  const rows = await countRowsInFile(file.absPath, file.compressed);
  return {
    file: {
      absPath: file.absPath,
      path: path.posix.join(
        partition,
        file.groupDir ? file.groupDir.split(path.sep).join(path.posix.sep) : "",
        path.basename(file.absPath),
      ),
      partition,
      groupKey: file.groupKey,
      day: file.day,
      hour: file.hour,
      level: file.level,
      compressed: file.compressed,
      bytes: stat.size,
      rows,
    },
    lastActivityMs: stat.mtimeMs,
  };
}

async function scanPartitions(dir: string, partitions: string[]): Promise<StorageScanSnapshot> {
  const baseDir = resolveDir(dir);
  if (!baseDir) throw new Error("missing-log-dir");
  const names = Array.from(new Set(partitions)).sort((a, b) => a.localeCompare(b));
  const partitionItems: StorageScanPartition[] = [];
  let files: StorageScanFile[] = [];

  for (const partition of names) {
    const scanned = await scanPartition(baseDir, partition);
    partitionItems.push(scanned.item);
    files = files.concat(scanned.files);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);

  return {
    partitions: partitionItems,
    files,
    total: {
      partitions: partitionItems.length,
      files: files.length,
      logs: files.reduce((sum, file) => sum + file.rows, 0),
      bytes: totalBytes,
      megabytes: bytesToMegabytes(totalBytes),
    },
  };
}

async function writeZipArchive(input: ArchiveCreateInput): Promise<void> {
  const entries: Record<string, Uint8Array> = {};
  const items = [
    ...input.generatedFiles.map((item) => ({ archivePath: item.archivePath, buffer: strToU8(item.content) })),
    ...await Promise.all(input.sourceFiles.map(async (item) => ({
      archivePath: item.archivePath,
      buffer: new Uint8Array(await fs.promises.readFile(item.sourcePath)),
    }))),
  ].sort((a, b) => a.archivePath.localeCompare(b.archivePath));

  for (const item of items) entries[path.posix.join(input.rootName, item.archivePath)] = item.buffer;

  const zipped = zipSync(entries, { level: 6 });
  await fs.promises.writeFile(input.outputPath, Buffer.from(zipped));
}

async function writeTarGzArchive(input: ArchiveCreateInput): Promise<void> {
  const pack = tar.pack();
  const gzip = zlib.createGzip({ level: 9 });
  const target = fs.createWriteStream(input.outputPath);
  pack.pipe(gzip).pipe(target);

  const items = [
    ...input.generatedFiles.map((item) => ({ archivePath: item.archivePath, buffer: Buffer.from(item.content, "utf8") })),
    ...await Promise.all(input.sourceFiles.map(async (item) => ({
      archivePath: item.archivePath,
      buffer: await fs.promises.readFile(item.sourcePath),
    }))),
  ].sort((a, b) => a.archivePath.localeCompare(b.archivePath));

  for (const item of items) {
    await new Promise<void>((resolve, reject) => {
      pack.entry(
        { name: path.posix.join(input.rootName, item.archivePath), size: item.buffer.length, mode: 0o644 },
        item.buffer,
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  pack.finalize();
  await finished(target);
}

async function createArchive(input: ArchiveCreateInput): Promise<void> {
  await fs.promises.mkdir(path.dirname(input.outputPath), { recursive: true });
  if (input.overwrite) await fs.promises.rm(input.outputPath, { force: true });
  if (input.format === "zip") {
    await writeZipArchive(input);
    return;
  }
  await writeTarGzArchive(input);
}

const jsStorageBackend: StorageBackend = {
  name: "js",
  scanPartitions,
  async rewritePartitionFiles(input) {
    await rewritePartitionFilesToTarget({
      sourceRoot: input.sourceRoot,
      sourceName: path.basename(input.sourceRoot),
      targetRoot: input.targetRoot,
      targetName: input.targetName,
      merge: input.merge,
    });
  },
  createArchive,
};

export { jsStorageBackend };
