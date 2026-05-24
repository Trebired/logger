import fs from "node:fs";

import type {
  CopyPartitionOptions,
  CreatePartitionOptions,
  DeletePartitionResult,
  MergePartitionOptions,
  MovePartitionOptions,
  PartitionInfo,
  RenamePartitionOptions,
} from "../../types.js";
import { sanitizePartitionName } from "../names.js";
import { deletePartitions } from "./delete.js";
import { readPartitionMarkerFromRoot, writePartitionMarker } from "./markers.js";
import { collectPartitionRecords, getPartitionRecord, partitionInfoFromRecord, requirePartitionRecord } from "./records.js";
import { mergePartitionRecord, transformPartition } from "./transforms.js";
import { partitionRootPath, pathExists, resolveDir } from "./internal.js";

async function createPartition(dir: string, partition: string, options: CreatePartitionOptions = {}): Promise<PartitionInfo> {
  const baseDir = resolveDir(dir);
  if (!baseDir) throw new Error("missing-log-dir");
  const name = sanitizePartitionName(partition);
  const rootDir = partitionRootPath(baseDir, name);
  if (await pathExists(rootDir)) throw new Error(`partition-already-exists: ${name}`);
  await writePartitionMarker(rootDir, {
    name,
    temporary: options.temporary === true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return (await getPartitionInfo(baseDir, name)) as PartitionInfo;
}

async function listPartitions(dir: string): Promise<PartitionInfo[]> {
  const records = await collectPartitionRecords(dir);
  const items = await Promise.all(records.map((record) => partitionInfoFromRecord(record)));
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

async function getPartitionInfo(dir: string, partition: string): Promise<PartitionInfo | null> {
  const record = await getPartitionRecord(dir, partition);
  return record ? partitionInfoFromRecord(record) : null;
}

async function renamePartition(dir: string, options: RenamePartitionOptions): Promise<PartitionInfo> {
  const source = await requirePartitionRecord(dir, options.from);
  return transformPartition({
    source,
    targetDir: source.dir,
    targetName: sanitizePartitionName(options.to),
    deleteSource: true,
    targetTemporary: source.marker.temporary,
    preserveSourceCreatedAt: true,
  });
}

async function movePartition(options: MovePartitionOptions): Promise<PartitionInfo> {
  const source = await requirePartitionRecord(options.fromDir, options.from);
  const targetName = sanitizePartitionName(options.to || source.name);
  return transformPartition({
    source,
    targetDir: resolveDir(options.toDir),
    targetName,
    deleteSource: true,
    targetTemporary: source.marker.temporary,
    preserveSourceCreatedAt: true,
  });
}

async function copyPartition(options: CopyPartitionOptions): Promise<PartitionInfo> {
  const source = await requirePartitionRecord(options.fromDir, options.from);
  const targetDir = resolveDir(options.toDir);
  const targetName = sanitizePartitionName(options.to || source.name);
  if (source.dir === targetDir && source.name === targetName) throw new Error(`partition-already-exists: ${targetName}`);
  return transformPartition({
    source,
    targetDir,
    targetName,
    deleteSource: false,
    targetTemporary: source.marker.temporary,
    preserveSourceCreatedAt: false,
  });
}

async function mergePartition(dir: string, options: MergePartitionOptions): Promise<PartitionInfo> {
  const source = await requirePartitionRecord(dir, options.from);
  const target = await requirePartitionRecord(dir, options.to);
  return mergePartitionRecord(source, target, target.marker.temporary);
}

async function deletePartition(dir: string, partition: string): Promise<DeletePartitionResult> {
  return deletePartitions(dir, { partitions: [partition] });
}

export {
  copyPartition,
  createPartition,
  deletePartition,
  getPartitionInfo,
  listPartitions,
  mergePartition,
  movePartition,
  renamePartition,
};
