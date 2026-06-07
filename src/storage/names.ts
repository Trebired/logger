import crypto from "node:crypto";
import path from "node:path";

import { TOP_LEVEL } from "../constants.js";
import { groupKeyFromRelDir } from "../groups.js";
import type {
  LogEntry,
  PartitionNameOptions,
  PartitionSanitizeOptions,
  PartitionSanitizer,
  PartitionTimeValue,
} from "../types.js";
import { getLocalDateTimeParts, normalizeTimeZone } from "../utils/datetime.js";
import { toString } from "../utils/values.js";

type ParsedLogFile = {
  day: string;
  hour: string;
  minute: string;
  second: string;
  sequence: number;
  level: string;
  compressed: boolean;
};

type WalkedLogFile = ParsedLogFile & {
  absPath: string;
  relDir: string;
  groupDir: string;
  groupKey: string;
  partition: string | null;
};

function sanitizePartitionFragment(input: string): string {
  return toString(input)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/_+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "");
}

function normalizePartitionValue(input: unknown, sanitizer?: PartitionSanitizer): string {
  const raw = toString(input);
  const prepared = typeof sanitizer === "function" ? sanitizer(raw) : raw;
  const normalized = sanitizePartitionFragment(prepared);
  if (!normalized) throw new Error("invalid-partition-name");
  return normalized;
}

function sanitizePartitionName(input: string, options: PartitionSanitizeOptions = {}): string {
  return normalizePartitionValue(input, options.sanitizer);
}

function partitionTimeParts(at: PartitionTimeValue | undefined, timeZone?: string) {
  return getLocalDateTimeParts(at, normalizeTimeZone(timeZone));
}

function formatPartitionTimePrefix(options: PartitionNameOptions = {}): string {
  const parts = partitionTimeParts(options.at, options.timeZone);
  const sequence = String(Math.max(1, Math.floor(Number(options.sequence) || 1)));
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}-${parts.minute}-${parts.second}-${sequence}`;
}

function buildPartitionName(options: PartitionNameOptions = {}): string {
  const prefix = formatPartitionTimePrefix(options);
  const suffix = toString(options.suffix).trim();
  if (!suffix) return prefix;

  const preparedSuffix = options.sanitizeSuffix === false
    ? suffix
    : typeof options.sanitizeSuffix === "function"
      ? options.sanitizeSuffix(suffix)
      : suffix;

  return sanitizePartitionName(`${prefix}-${preparedSuffix}`);
}

function buildTemporaryPartitionName(options: PartitionNameOptions = {}): string {
  const suffix = toString(options.suffix).trim();
  const random = crypto.randomBytes(4).toString("hex");
  const prefix = formatPartitionTimePrefix(options);
  if (!suffix) return sanitizePartitionName(`${prefix}-tmp-${random}`);

  const preparedSuffix = options.sanitizeSuffix === false
    ? suffix
    : typeof options.sanitizeSuffix === "function"
      ? options.sanitizeSuffix(suffix)
      : suffix;

  return sanitizePartitionName(`${prefix}-${preparedSuffix}-tmp-${random}`);
}

function normalizePartitionKey(input: unknown): string {
  const raw = toString(input).trim();
  if (!raw) return "";
  return sanitizePartitionName(raw);
}

function nowFileStamp(date = new Date(), timeZone?: string): string {
  const parts = partitionTimeParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}-${parts.minute}-${parts.second}`;
}

function fileStampForEntry(entry: LogEntry, timeZone?: string): string {
  const date = entry.recorded_at ? new Date(entry.recorded_at) : new Date();
  return Number.isFinite(date.getTime()) ? nowFileStamp(date, timeZone) : nowFileStamp(undefined, timeZone);
}

function makeLogFileName(stamp: string, sequence: number, level: string): string {
  const seq = String(Math.max(1, Math.floor(sequence)));
  return `${stamp}-${seq}-${level}.jsonl`;
}

function parseLogFileName(fileName: string): ParsedLogFile | null {
  const match = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d+)-([a-z0-9._-]+)\.jsonl(\.gz)?$/i.exec(fileName);
  if (!match) return null;

  return {
    day: match[1],
    hour: match[2],
    minute: match[3],
    second: match[4],
    sequence: Math.max(1, Number(match[5]) || 1),
    level: match[6],
    compressed: Boolean(match[7]),
  };
}

function walkedFileFromPath(baseDir: string, filePath: string, partition: string | null = null, rootDir?: string): WalkedLogFile | null {
  const parsed = parseLogFileName(path.basename(filePath));
  if (!parsed) return null;
  const relativeRoot = rootDir || baseDir;
  const relDir = path.relative(relativeRoot, path.dirname(filePath));
  const groupDir = relDir && relDir !== "." ? relDir : "";

  return {
    ...parsed,
    absPath: filePath,
    relDir: path.relative(baseDir, path.dirname(filePath)),
    groupDir,
    groupKey: groupDir ? groupKeyFromRelDir(groupDir) : TOP_LEVEL,
    partition,
  };
}

export {
  buildPartitionName,
  buildTemporaryPartitionName,
  fileStampForEntry,
  formatPartitionTimePrefix,
  makeLogFileName,
  normalizePartitionKey,
  nowFileStamp,
  parseLogFileName,
  sanitizePartitionName,
  walkedFileFromPath,
};
export type { ParsedLogFile, WalkedLogFile };
