import fs from "node:fs";
import zlib from "node:zlib";

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

async function cleanupLogs(dir: string, options: NormalizedRetentionOptions): Promise<void> {
  if (!options.enabled || !dir) return;
  const files = await walkLogFiles(dir);
  const cutoff = Date.now() - options.maxAgeDays * 24 * 60 * 60 * 1000;
  const now = currentDayHour();

  for (const file of files) {
    try {
      const stat = await fs.promises.stat(file.absPath);
      if (stat.mtimeMs < cutoff) {
        await fs.promises.unlink(file.absPath);
        continue;
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
}

export { cleanupLogs, compressFile };
