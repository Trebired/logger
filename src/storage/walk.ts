import fs from "node:fs";
import path from "node:path";

import { PARTITION_MARKER_FILE } from "../constants.js";
import { walkedFileFromPath, type WalkedLogFile } from "./names.js";

async function hasPartitionMarker(dir: string): Promise<boolean> {
  try {
    await fs.promises.access(path.join(dir, PARTITION_MARKER_FILE));
    return true;
  } catch {
    return false;
  }
}

function hasPartitionMarkerSync(dir: string): boolean {
  try {
    fs.accessSync(path.join(dir, PARTITION_MARKER_FILE));
    return true;
  } catch {
    return false;
  }
}

async function walkTree(baseDir: string, startDir: string, rootDir: string, partition: string | null, out: WalkedLogFile[]): Promise<void> {
  const stack = [startDir];

  while (stack.length) {
    const dir = stack.pop() || "";
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === PARTITION_MARKER_FILE) continue;

      const walked = walkedFileFromPath(baseDir, absPath, partition, rootDir);
      if (walked) out.push(walked);
    }
  }
}

function walkTreeSync(baseDir: string, startDir: string, rootDir: string, partition: string | null, out: WalkedLogFile[]): void {
  const stack = [startDir];

  while (stack.length) {
    const dir = stack.pop() || "";
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === PARTITION_MARKER_FILE) continue;

      const walked = walkedFileFromPath(baseDir, absPath, partition, rootDir);
      if (walked) out.push(walked);
    }
  }
}

async function walkLogFiles(baseDir: string): Promise<WalkedLogFile[]> {
  const out: WalkedLogFile[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const absPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      if (await hasPartitionMarker(absPath)) {
        await walkTree(baseDir, absPath, absPath, entry.name, out);
        continue;
      }
      await walkTree(baseDir, absPath, baseDir, null, out);
      continue;
    }
    if (!entry.isFile() || entry.name === PARTITION_MARKER_FILE) continue;
    const walked = walkedFileFromPath(baseDir, absPath, null, baseDir);
    if (walked) out.push(walked);
  }

  return out;
}

function walkLogFilesSync(baseDir: string): WalkedLogFile[] {
  const out: WalkedLogFile[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const absPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      if (hasPartitionMarkerSync(absPath)) {
        walkTreeSync(baseDir, absPath, absPath, entry.name, out);
        continue;
      }
      walkTreeSync(baseDir, absPath, baseDir, null, out);
      continue;
    }
    if (!entry.isFile() || entry.name === PARTITION_MARKER_FILE) continue;
    const walked = walkedFileFromPath(baseDir, absPath, null, baseDir);
    if (walked) out.push(walked);
  }

  return out;
}

export { walkLogFiles, walkLogFilesSync };
