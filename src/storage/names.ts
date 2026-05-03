import path from "node:path";

import { TOP_LEVEL } from "../constants.js";
import { groupKeyFromRelDir } from "../groups.js";
import type { LogEntry } from "../types.js";
import { getLocalDateTimeParts, normalizeTimeZone } from "../utils/datetime.js";

type ParsedLogFile = {
  day: string;
  hour: string;
  sequence: number;
  level: string;
  compressed: boolean;
};

type WalkedLogFile = ParsedLogFile & {
  absPath: string;
  relDir: string;
  groupKey: string;
};

function nowFileStamp(date = new Date(), timeZone?: string): string {
  const parts = getLocalDateTimeParts(date, normalizeTimeZone(timeZone));
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}`;
}

function fileStampForEntry(entry: LogEntry, timeZone?: string): string {
  const date = entry.recorded_at ? new Date(entry.recorded_at) : new Date();
  return Number.isFinite(date.getTime()) ? nowFileStamp(date, timeZone) : nowFileStamp(undefined, timeZone);
}

function makeLogFileName(stamp: string, sequence: number, level: string): string {
  const seq = String(Math.max(0, Math.floor(sequence))).padStart(4, "0");
  return `${stamp}-${seq}-${level}.jsonl`;
}

function parseLogFileName(fileName: string): ParsedLogFile | null {
  const next = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d+)-([a-z0-9._-]+)\.jsonl(\.gz)?$/i.exec(fileName);
  if (next) {
    return {
      day: next[1],
      hour: next[2],
      sequence: Number(next[3]) || 0,
      level: next[4],
      compressed: Boolean(next[5]),
    };
  }

  const legacyWithSequence = /^(\d{2}-\d{2}-\d{4})-(\d{2})-(\d+)-([a-z0-9._-]+)\.log\.json(\.gz)?$/i.exec(fileName);
  if (legacyWithSequence) {
    return {
      day: legacyWithSequence[1],
      hour: legacyWithSequence[2],
      sequence: Number(legacyWithSequence[3]) || 0,
      level: legacyWithSequence[4],
      compressed: Boolean(legacyWithSequence[5]),
    };
  }

  const legacy = /^(\d{2}-\d{2}-\d{4})-(\d{2})-([a-z0-9._-]+)\.log\.json(\.gz)?$/i.exec(fileName);
  if (!legacy) return null;

  return {
    day: legacy[1],
    hour: legacy[2],
    sequence: 0,
    level: legacy[3],
    compressed: Boolean(legacy[4]),
  };
}

function walkedFileFromPath(baseDir: string, filePath: string): WalkedLogFile | null {
  const parsed = parseLogFileName(path.basename(filePath));
  if (!parsed) return null;
  const relDir = path.relative(baseDir, path.dirname(filePath));

  return {
    ...parsed,
    absPath: filePath,
    relDir,
    groupKey: relDir && relDir !== "." ? groupKeyFromRelDir(relDir) : TOP_LEVEL,
  };
}

export { fileStampForEntry, makeLogFileName, nowFileStamp, parseLogFileName, walkedFileFromPath };
export type { ParsedLogFile, WalkedLogFile };
