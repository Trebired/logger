import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { PARTITION_MARKER_FILE } from "../constants.js";
import type { NormalizedRetentionOptions } from "../types.js";
import { nowFileStamp } from "./names.js";
import { walkLogFiles } from "./walk.js";

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
    try {
      await fs.promises.access(path.join(root, PARTITION_MARKER_FILE));
      roots.push(root);
    } catch {}
  }

  return roots;
}

async function cleanupLogs(dir: string, options: NormalizedRetentionOptions): Promise<void> {
  if (!options.enabled || !dir) return;
  const files = await walkLogFiles(dir);
  const cutoff = options.maxAgeDays == null ? null : Date.now() - options.maxAgeDays * 24 * 60 * 60 * 1000;
  const now = currentDayHour();
  const partitionActivity = new Map<string, number>();

  for (const file of files) {
    try {
      const stat = await fs.promises.stat(file.absPath);
      if (cutoff != null && stat.mtimeMs < cutoff) {
        await fs.promises.unlink(file.absPath);
        continue;
      }

      if (file.partition) {
        const rootDir = path.join(dir, file.partition);
        const last = partitionActivity.get(rootDir) || 0;
        if (stat.mtimeMs > last) partitionActivity.set(rootDir, stat.mtimeMs);
      }

      if (
        options.compressOldFiles &&
        !file.compressed &&
        (file.day !== now.day || file.hour !== now.hour)
      ) {
        await compressFile(file.absPath);
      }
    } catch {}
  }

  if (options.maxPartitions == null) return;

  const roots = await listPartitionRoots(dir);
  const ranked = await Promise.all(roots.map(async (rootDir) => {
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

export { cleanupLogs, compressFile };
