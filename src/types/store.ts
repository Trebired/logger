import type { ResultLike } from "@package/result";

import type { LogEntry, LogLevelConfig } from "./common.js";

type PartitionSanitizer = (value: string) => string;

type PartitionTimeValue = string | number | Date;

type PartitionSanitizeOptions = {
  sanitizer?: PartitionSanitizer;
};

type PartitionNameOptions = {
  at?: PartitionTimeValue;
  timeZone?: string;
  sequence?: number;
  suffix?: string | null;
  sanitizeSuffix?: PartitionSanitizer | false;
};

type LogTimeValue = string | number | Date;

type PartitionScope = string | null;

type LogQueryOptions = {
  levels?: Record<string, LogLevelConfig>;
  partition?: PartitionScope;
  level?: string | string[];
  minLevel?: string;
  group?: string;
  since?: LogTimeValue;
  until?: LogTimeValue;
  search?: string;
  limit?: number;
  cursor?: string | null;
  offset?: number;
  order?: "asc" | "desc";
  count?: boolean;
};

type LogQueryResult = {
  entries: LogEntry[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number | null;
  levels: Record<string, LogLevelConfig>;
};

type ListGroupsOptions = {
  partition?: PartitionScope;
};

type LogGroupSummary = {
  group: string;
  entries: number;
  lastAt: string | null;
};

type PartitionInfo = {
  name: string;
  temporary: boolean;
  createdAt: string;
  firstAt: string | null;
  lastAt: string | null;
  entries: number;
  bytes: number;
};

type PartitionListResult = {
  items: PartitionInfo[];
  total: {
    partitions: number;
    entries: number;
    bytes: number;
  };
};

type SetPartitionOptions = {
  temporary?: boolean;
};

type PartitionExistsPolicy = "error" | "merge" | "replace";

type FinalizePartitionOptions = {
  ifExists?: PartitionExistsPolicy;
};

type FinalizePartitionAction =
|"activated"
|"already-final"
|"marked-permanent"
|"merged"
|"renamed"
|"replaced";

type FinalizePartitionResult = {
  partition: string;
  previousPartition: string | null;
  action: FinalizePartitionAction;
  movedEntries: number;
  result: ResultLike<{
    action: FinalizePartitionAction;
    partition: string;
  }>;
};

type RenamePartitionOptions = {
  from: string;
  to: string;
  ifExists?: PartitionExistsPolicy;
};

type DeletePartitionsOptions = {
  names?: string[];
  temporary?: boolean;
  olderThan?: LogTimeValue;
  keep?: string[];
};

type DeletePartitionsResult = {
  partitions: number;
  entries: number;
  items: string[];
};

type ExportFormat = "jsonl" | "jsonl.gz";

type ExportLogsOptions = Omit<LogQueryOptions, "count"|"cursor"|"limit"|"offset"|"order">& {
  outputPath: string;
  format?: ExportFormat;
  overwrite?: boolean;
};

type ExportLogsResult = {
  path: string;
  format: ExportFormat;
  entries: number;
  bytes: number;
};

type SnapshotStoreOptions = {
  outputPath: string;
  overwrite?: boolean;
};

type SnapshotStoreResult = {
  path: string;
  bytes: number;
};

type RetentionRunResult = {
  deletedEntries: number;
  deletedPartitions: number;
  bytesBefore: number;
  bytesAfter: number;
};

export type {
  DeletePartitionsOptions,
  DeletePartitionsResult,
  ExportFormat,
  ExportLogsOptions,
  ExportLogsResult,
  FinalizePartitionAction,
  FinalizePartitionOptions,
  FinalizePartitionResult,
  ListGroupsOptions,
  LogGroupSummary,
  LogQueryOptions,
  LogQueryResult,
  LogTimeValue,
  PartitionExistsPolicy,
  PartitionInfo,
  PartitionListResult,
  PartitionNameOptions,
  PartitionSanitizeOptions,
  PartitionSanitizer,
  PartitionScope,
  PartitionTimeValue,
  RenamePartitionOptions,
  RetentionRunResult,
  SetPartitionOptions,
  SnapshotStoreOptions,
  SnapshotStoreResult,
};
