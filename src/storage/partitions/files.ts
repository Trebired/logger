import fs from "node:fs";
import path from "node:path";

import { PARTITION_MARKER_FILE } from "#cuh2x5snaefd";
import type { DeleteLogsOptions } from "#tvzweoxg5ahk";
import { normGroup } from "#8xmnu037caa7";
import { toString } from "#ycytzc4gr3f7";
import { walkedFileFromPath, type WalkedLogFile } from "#x2qkmwodgsce";
import type { PartitionMarker } from "./internal.js";
import { partitionMarkerMap } from "./records.js";
import { collectPartitionFiles, findAvailableTargetPath, readLogRows, writeLogRows, writePartitionFiles } from "./rewrite.js";

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
