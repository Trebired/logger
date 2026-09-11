import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import type { NormalizedRetentionOptions } from "#e1h3ay0cyhgl";
import { nowFileStamp } from "./names.js";
import { readPartitionMarkerFromRoot } from "./partitions.js";
import { getStorageBackend } from "./backend/index.js";
import { walkLogFilesEach } from "./walk.js";
import type { WalkedLogFile } from "./names.js";

function currentDayHour(): { day: string; hour: string } {
  const stamp = nowFileStamp();
  return {
    day: stamp.slice(0, 10),
    hour: stamp.slice(11, 13),
  };
}

async function compressFile(filePath: string): Promise<void> {
  if (filePath.endsWith(".gz")) return;
  const target = `${filePath}.gz`;
  try {
    await fs.promises.access(target);
    await fs.promises.unlink(filePath);
    return;
  } catch {}

  const data = await fs.promises.readFile(filePath);
  const compressed = zlib.gzipSync(data);
  await fs.promises.writeFile(target, compressed);
  await fs.promises.unlink(filePath);
}

async function listPartitionRoots(dir: string): Promise<string[]> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const roots: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = path.join(dir, entry.name);
    if (await readPartitionMarkerFromRoot(root, entry.name)) roots.push(root);
  }

  return roots;
}

async function cleanupLogs(dir: string, options: NormalizedRetentionOptions): Promise<void> {
  if (!options.enabled || !dir) return;
  const now = currentDayHour();
  const backend = getStorageBackend();
  if (typeof backend.cleanupLogs === "function") {
    await backend.cleanupLogs({
        compressOldFiles: options.compressOldFiles === true,
        dir,
        maxAgeDays: options.maxAgeDays == null ? null : Number(options.maxAgeDays),
        maxPartitions: options.maxPartitions == null ? null : Number(options.maxPartitions),
        nowDay: now.day,
        nowHour: now.hour,
    });
    return;
  }

  const cutoff = options.maxAgeDays == null ? null : Date.now() - options.maxAgeDays * 24 * 60 * 60 * 1000;
  const partitionActivity = new Map<string, number>();

  await walkLogFilesEach(dir, async(file) => {
      await cleanupLogFile(dir, file, cutoff, now, options, partitionActivity);
  });

  if (options.maxPartitions == null) return;

  const roots = await listPartitionRoots(dir);
  const ranked = await Promise.all(roots.map(async(rootDir) => {
        let lastActivity = partitionActivity.get(rootDir) || 0;
        if (!lastActivity) {
          try {
            const stat = await fs.promises.stat(rootDir);
            lastActivity = stat.mtimeMs;
          } catch {}
        }
        return { rootDir, lastActivity };
  }));

  ranked.sort((a, b) => b.lastActivity - a.lastActivity);
  const toDelete = ranked.slice(Math.max(0, options.maxPartitions));
  for (const item of toDelete) {
    try {
      await fs.promises.rm(item.rootDir, { recursive: true, force: true });
    } catch {}
  }
}

async function cleanupLogFile(
  dir: string,
  file: WalkedLogFile,
  cutoff: number | null,
  now: ReturnType<typeof currentDayHour>,
  options: NormalizedRetentionOptions,
  partitionActivity: Map<string, number>,
): Promise<void> {
  try {
    const stat = await fs.promises.stat(file.absPath);
    if (cutoff != null && stat.mtimeMs < cutoff) {
      await fs.promises.unlink(file.absPath);
      return;
    }

    updatePartitionActivity(dir, file.partition, stat.mtimeMs, partitionActivity);

    if (shouldCompressFile(file, now, options)) {
      await compressFile(file.absPath);
    }
  } catch {}
}

function updatePartitionActivity(
  dir: string,
  partition: string | null | undefined,
  mtimeMs: number,
  partitionActivity: Map<string, number>,
): void {
  if (!partition) {
    return;
  }

  const rootDir = path.join(dir, partition);
  const last = partitionActivity.get(rootDir) || 0;
  if (mtimeMs > last) {
    partitionActivity.set(rootDir, mtimeMs);
  }
}

function shouldCompressFile(
  file: WalkedLogFile,
  now: ReturnType<typeof currentDayHour>,
  options: NormalizedRetentionOptions,
): boolean {
  return (
    options.compressOldFiles &&
      !file.compressed &&
      (file.day !== now.day || file.hour !== now.hour)
  );
}

export { cleanupLogs, compressFile };
