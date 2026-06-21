import fs from "node:fs";
import path from "node:path";

import type { PartitionAggregateTotals, PartitionInfo, PartitionListResult, PartitionTotals } from "#tvzweoxg5ahk";
import { bytesToMegabytes } from "#unnkpg8o07bp";
import { getStorageBackend } from "#1qrb8ldbr5aj";
import { sanitizePartitionName } from "#x2qkmwodgsce";
import { readPartitionMarkerFromRoot } from "./markers.js";
import { partitionRootPath, resolveDir, type PartitionMarker, type PartitionRecord } from "./internal.js";

async function collectPartitionRecords(dir: string): Promise<PartitionRecord[]> {
  const baseDir = resolveDir(dir);
  if (!baseDir) return [];
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: PartitionRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const rootDir = path.join(baseDir, name);
    const marker = await readPartitionMarkerFromRoot(rootDir, name);
    if (!marker) continue;
    out.push({ dir: baseDir, name, path: rootDir, marker });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function getPartitionRecord(dir: string, partition: string): Promise<PartitionRecord | null> {
  const baseDir = resolveDir(dir);
  if (!baseDir) return null;
  const name = sanitizePartitionName(partition);
  const rootDir = partitionRootPath(baseDir, name);
  const marker = await readPartitionMarkerFromRoot(rootDir, name);
  if (!marker) return null;
  return { dir: baseDir, name, path: rootDir, marker };
}

async function requirePartitionRecord(dir: string, partition: string): Promise<PartitionRecord> {
  const record = await getPartitionRecord(dir, partition);
  if (!record) throw new Error(`partition-not-found: ${partition}`);
  return record;
}

function partitionTotalsFromSummary(summary?: {
  total?: {
    logs?: number;
    dirs?: number;
    files?: number;
    bytes?: number;
    megabytes?: number;
  };
}): PartitionTotals {
  const bytes = summary?.total?.bytes || 0;
  return {
    logs: summary?.total?.logs || 0,
    dirs: summary?.total?.dirs || 0,
    files: summary?.total?.files || 0,
    bytes,
    megabytes: summary?.total?.megabytes || bytesToMegabytes(bytes),
  };
}

async function partitionInfoFromRecord(record: PartitionRecord): Promise<PartitionInfo> {
  const backend = getStorageBackend();
  const snapshot = await backend.scanPartitions(record.dir, [record.name]);
  const summary = snapshot.partitions[0];

  return {
    name: record.name,
    path: record.path,
    temporary: record.marker.temporary,
    created_at: record.marker.created_at,
    updated_at: record.marker.updated_at,
    last_activity_at: summary?.lastActivityAt || null,
    total: partitionTotalsFromSummary(summary),
  };
}

function partitionListResult(items: PartitionInfo[]): PartitionListResult {
  const total = items.reduce<PartitionAggregateTotals>((acc, item) => ({
    partitions: acc.partitions + 1,
    logs: acc.logs + item.total.logs,
    dirs: acc.dirs + item.total.dirs,
    files: acc.files + item.total.files,
    bytes: acc.bytes + item.total.bytes,
    megabytes: acc.megabytes + item.total.megabytes,
  }), {
    partitions: 0,
    logs: 0,
    dirs: 0,
    files: 0,
    bytes: 0,
    megabytes: 0,
  });

  return Object.assign(items, { total }) as PartitionListResult;
}

async function partitionMarkerMap(dir: string): Promise<Map<string, PartitionMarker>> {
  const records = await collectPartitionRecords(dir);
  return new Map(records.map((record) => [record.name, record.marker]));
}

export {
  collectPartitionRecords,
  getPartitionRecord,
  partitionInfoFromRecord,
  partitionListResult,
  partitionMarkerMap,
  requirePartitionRecord,
};
