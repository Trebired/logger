import fs from "node:fs";
import path from "node:path";

import type { PartitionInfo } from "../../types.js";
import { sanitizePartitionName } from "../names.js";
import { writePartitionMarker } from "./markers.js";
import { getPartitionInfo } from "./public.js";
import { writePartitionFiles } from "./files.js";
import { partitionRootPath, pathExists, resolveDir, type PartitionRecord, type PartitionTransformOptions } from "./internal.js";

async function transformPartition(options: PartitionTransformOptions): Promise<PartitionInfo> {
  const targetDir = resolveDir(options.targetDir);
  if (!targetDir) throw new Error("missing-log-dir");
  const targetName = sanitizePartitionName(options.targetName);
  const targetRoot = partitionRootPath(targetDir, targetName);

  if (options.source.path === targetRoot) {
    await writePartitionMarker(targetRoot, {
      name: targetName,
      temporary: options.targetTemporary,
      created_at: options.source.marker.created_at,
      updated_at: new Date().toISOString(),
    });
    return (await getPartitionInfo(targetDir, targetName)) as PartitionInfo;
  }

  if (await pathExists(targetRoot)) throw new Error(`partition-already-exists: ${targetName}`);

  const tempRoot = path.join(targetDir, `.trebired-partition-build-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    await fs.promises.mkdir(targetDir, { recursive: true });
    await writePartitionFiles(options.source, tempRoot, targetName, false);
    await writePartitionMarker(tempRoot, {
      name: targetName,
      temporary: options.targetTemporary,
      created_at: options.preserveSourceCreatedAt ? options.source.marker.created_at : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await fs.promises.rename(tempRoot, targetRoot);
    if (options.deleteSource) await fs.promises.rm(options.source.path, { recursive: true, force: true });
    return (await getPartitionInfo(targetDir, targetName)) as PartitionInfo;
  } catch (error) {
    await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function mergePartitionRecord(source: PartitionRecord, target: PartitionRecord, temporary: boolean): Promise<PartitionInfo> {
  if (source.path === target.path) throw new Error(`partition-merge-target-same-as-source: ${source.name}`);
  await writePartitionFiles(source, target.path, target.name, true);
  await writePartitionMarker(target.path, {
    name: target.name,
    temporary,
    created_at: target.marker.created_at,
    updated_at: new Date().toISOString(),
  });
  await fs.promises.rm(source.path, { recursive: true, force: true });
  return (await getPartitionInfo(target.dir, target.name)) as PartitionInfo;
}

export { mergePartitionRecord, transformPartition };
