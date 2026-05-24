import { afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import zlib from "node:zlib";

import { unzipSync } from "fflate";
import tar from "tar-stream";

import { createLog, logStream } from "../../src/index";

const handlers: any[] = [];

function tempDir(prefix = "test_"): string {
  const parent = path.join(os.tmpdir(), "@trebired-logger");
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, prefix));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function captureNextLog(fn: (log: any) => void, options?: Record<string, unknown>) {
  const log = createLog({ console: false, save: false, ...(options || {}) } as any);
  const events: any[] = [];
  const handler = (entry: any, context: any) => events.push({ entry, context });
  handlers.push(handler);
  logStream.on("log", handler);
  fn(log);
  return events[events.length - 1];
}

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop() || "";
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else out.push(abs);
    }
  }
  return out.sort();
}

function captureStdout(fn: () => void): string {
  const originalWrite = process.stdout.write;
  let output = "";

  try {
    (process.stdout as any).write = (chunk: unknown) => {
      output += String(chunk);
      return true;
    };
    fn();
  } finally {
    (process.stdout as any).write = originalWrite;
  }

  return output;
}

function captureStderr(fn: () => void): string {
  const originalWrite = process.stderr.write;
  let output = "";

  try {
    (process.stderr as any).write = (chunk: unknown) => {
      output += String(chunk);
      return true;
    };
    fn();
  } finally {
    (process.stderr as any).write = originalWrite;
  }

  return output;
}

function forceRecordedAt(value: string): Record<string, unknown> {
  return { __recorded_at: value };
}

function partitionMarkerPath(dir: string, partition: string): string {
  return path.join(dir, partition, ".trebired-partition.json");
}

function readPartitionMarker(dir: string, partition: string) {
  return JSON.parse(fs.readFileSync(partitionMarkerPath(dir, partition), "utf8"));
}

function writePartitionMarker(dir: string, partition: string, marker: Record<string, unknown>): void {
  fs.writeFileSync(partitionMarkerPath(dir, partition), `${JSON.stringify(marker)}\n`, "utf8");
}

function groupDir(rootDir: string, groupKey: string): string {
  const parts = groupKey.split(".").map((part) => part.replace(/[^a-zA-Z0-9_-]/g, "-")).filter(Boolean);
  return path.join(rootDir, ...(parts.length ? parts : ["top-level"]));
}

function writePartitionLogFile(
  dir: string,
  partition: string,
  groupKey: string,
  fileName: string,
  rows: Array<Record<string, unknown>>,
  compressed = false,
): void {
  const root = path.join(dir, partition);
  const targetDir = groupDir(root, groupKey);
  fs.mkdirSync(targetDir, { recursive: true });
  const payload = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  const targetPath = path.join(targetDir, compressed ? `${fileName}.gz` : fileName);
  if (compressed) {
    fs.writeFileSync(targetPath, zlib.gzipSync(Buffer.from(payload, "utf8")));
  } else {
    fs.writeFileSync(targetPath, payload, "utf8");
  }
}

async function readTarGzEntries(filePath: string): Promise<Map<string, Buffer>> {
  const gzipped = await fs.promises.readFile(filePath);
  const tarBuffer = zlib.gunzipSync(gzipped);
  const extract = tar.extract();
  const out = new Map<string, Buffer>();

  await new Promise<void>((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on("error", reject);
      stream.on("end", () => {
        out.set(header.name, Buffer.concat(chunks));
        next();
      });
      stream.resume();
    });
    extract.on("finish", resolve);
    extract.on("error", reject);
    extract.end(tarBuffer);
  });

  return out;
}

async function readZipEntries(filePath: string): Promise<Map<string, Buffer>> {
  const zipped = await fs.promises.readFile(filePath);
  const out = new Map<string, Buffer>();
  const entries = unzipSync(new Uint8Array(zipped));
  for (const [name, data] of Object.entries(entries)) out.set(name, Buffer.from(data));
  return out;
}

async function readArchiveEntries(filePath: string): Promise<Map<string, Buffer>> {
  if (filePath.endsWith(".zip")) return readZipEntries(filePath);
  return readTarGzEntries(filePath);
}

function canBuildNativeAddon(): boolean {
  return spawnSync("cargo", ["--version"], { stdio: "ignore" }).status === 0;
}

afterEach(() => {
  while (handlers.length) {
    const handler = handlers.pop();
    logStream.off("log", handler);
  }
});

export {
  captureNextLog,
  captureStderr,
  captureStdout,
  forceRecordedAt,
  groupDir,
  listFilesRecursive,
  readArchiveEntries,
  readPartitionMarker,
  sleep,
  tempDir,
  canBuildNativeAddon,
  writePartitionLogFile,
  writePartitionMarker,
};
