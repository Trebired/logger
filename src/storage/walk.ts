import fs from "node:fs";
import path from "node:path";

import { walkedFileFromPath, type WalkedLogFile } from "./names.js";

async function walkLogFiles(baseDir: string): Promise<WalkedLogFile[]> {
  const out: WalkedLogFile[] = [];
  const stack = [baseDir];

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

      const walked = walkedFileFromPath(baseDir, absPath);
      if (walked) out.push(walked);
    }
  }

  return out;
}

function walkLogFilesSync(baseDir: string): WalkedLogFile[] {
  const out: WalkedLogFile[] = [];
  const stack = [baseDir];

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

      const walked = walkedFileFromPath(baseDir, absPath);
      if (walked) out.push(walked);
    }
  }

  return out;
}

export { walkLogFiles, walkLogFilesSync };
