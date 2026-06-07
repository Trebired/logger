import fs from "node:fs";
import path from "node:path";

import type { PartitionInfo } from "../../types.js";
import { toString } from "../../utils/values.js";
import type { WalkedLogFile } from "../names.js";

type PartitionMarker = {
  name: string;
  temporary: boolean;
  created_at: string;
  updated_at: string;
};

type PartitionRecord = {
  dir: string;
  name: string;
  path: string;
  marker: PartitionMarker;
};

type PartitionWriteOptions = {
  temporary?: boolean;
  preserveTemporary?: boolean;
  createdAt?: string;
  updatedAt?: string;
  preserveCreatedAt?: boolean;
};

type PartitionTransformOptions = {
  source: PartitionRecord;
  targetDir: string;
  targetName: string;
  deleteSource: boolean;
  targetTemporary: boolean;
  preserveSourceCreatedAt: boolean;
};

type PartitionDeleteCandidate = {
  info: PartitionInfo;
  record: PartitionRecord;
};

type DeleteLogCandidate = {
  file: WalkedLogFile;
  bytes: number;
  logs: number;
};

function resolveDir(input: string): string {
  const raw = toString(input).trim();
  return raw ? path.resolve(raw) : "";
}

function partitionRootPath(dir: string, partition: string): string {
  return path.join(dir, partition);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function fileStamp(file: WalkedLogFile): string {
  return `${file.day}-${file.hour}-${file.minute}-${file.second}`;
}

function partitionAgeReferenceMs(info: PartitionInfo): number {
  const reference = info.last_activity_at || info.updated_at || info.created_at;
  const parsed = Date.parse(reference);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cutoffMsForDays(days: number | undefined): number | null {
  const value = Number(days);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Date.now() - value * 24 * 60 * 60 * 1000;
}

export {
  cutoffMsForDays,
  fileStamp,
  partitionAgeReferenceMs,
  partitionRootPath,
  pathExists,
  resolveDir,
};
export type {
  DeleteLogCandidate,
  PartitionDeleteCandidate,
  PartitionMarker,
  PartitionRecord,
  PartitionTransformOptions,
  PartitionWriteOptions,
};
