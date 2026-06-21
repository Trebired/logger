import fs from "node:fs";
import path from "node:path";

import { PARTITION_MARKER_FILE } from "#cuh2x5snaefd";
import { sanitizePartitionName } from "#x2qkmwodgsce";
import { partitionRootPath, resolveDir, type PartitionMarker, type PartitionWriteOptions } from "./internal.js";

function isValidMarker(value: unknown, expectedName?: string): value is PartitionMarker {
  if (!value || typeof value !== "object") return false;
  const marker = value as Record<string, unknown>;
  if (String(marker.name || "") !== (expectedName || String(marker.name || ""))) return false;
  if (typeof marker.temporary !== "boolean") return false;
  if (!String(marker.created_at || "").trim()) return false;
  if (!String(marker.updated_at || "").trim()) return false;
  return true;
}

function markerPath(rootDir: string): string {
  return path.join(rootDir, PARTITION_MARKER_FILE);
}

async function readPartitionMarkerFromRoot(rootDir: string, expectedName?: string): Promise<PartitionMarker | null> {
  try {
    const text = await fs.promises.readFile(markerPath(rootDir), "utf8");
    const parsed = JSON.parse(text);
    return isValidMarker(parsed, expectedName) ? parsed : null;
  } catch {
    return null;
  }
}

function readPartitionMarkerFromRootSync(rootDir: string, expectedName?: string): PartitionMarker | null {
  try {
    const text = fs.readFileSync(markerPath(rootDir), "utf8");
    const parsed = JSON.parse(text);
    return isValidMarker(parsed, expectedName) ? parsed : null;
  } catch {
    return null;
  }
}

function nextMarker(existing: PartitionMarker | null, name: string, options: PartitionWriteOptions = {}): PartitionMarker {
  const now = options.updatedAt || new Date().toISOString();
  const created_at = options.createdAt
    || ((options.preserveCreatedAt !== false && existing?.created_at) ? existing.created_at : now);
  const temporary = typeof options.temporary === "boolean"
    ? options.temporary
    : (options.preserveTemporary !== false && existing ? existing.temporary : false);

  return {
    name,
    temporary,
    created_at,
    updated_at: now,
  };
}

async function writePartitionMarker(rootDir: string, marker: PartitionMarker): Promise<void> {
  await fs.promises.mkdir(rootDir, { recursive: true });
  await fs.promises.writeFile(markerPath(rootDir), `${JSON.stringify(marker)}\n`, "utf8");
}

function writePartitionMarkerSync(rootDir: string, marker: PartitionMarker): void {
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(markerPath(rootDir), `${JSON.stringify(marker)}\n`, "utf8");
}

async function touchPartitionMarker(dir: string, partition: string, options: PartitionWriteOptions = {}): Promise<PartitionMarker> {
  const baseDir = resolveDir(dir);
  if (!baseDir) throw new Error("missing-log-dir");
  const name = sanitizePartitionName(partition);
  const rootDir = partitionRootPath(baseDir, name);
  const existing = await readPartitionMarkerFromRoot(rootDir, name);
  const marker = nextMarker(existing, name, options);
  await writePartitionMarker(rootDir, marker);
  return marker;
}

function touchPartitionMarkerSync(dir: string, partition: string, options: PartitionWriteOptions = {}): PartitionMarker {
  const baseDir = resolveDir(dir);
  if (!baseDir) throw new Error("missing-log-dir");
  const name = sanitizePartitionName(partition);
  const rootDir = partitionRootPath(baseDir, name);
  const existing = readPartitionMarkerFromRootSync(rootDir, name);
  const marker = nextMarker(existing, name, options);
  writePartitionMarkerSync(rootDir, marker);
  return marker;
}

export {
  readPartitionMarkerFromRoot,
  readPartitionMarkerFromRootSync,
  touchPartitionMarker,
  touchPartitionMarkerSync,
  writePartitionMarker,
};
