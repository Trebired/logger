type PartitionSanitizer = (value: string) => string;

type PartitionTimeValue = string | number | Date;

type PartitionSanitizeOptions = {
  sanitizer?: PartitionSanitizer;
};

type PartitionNameOptions = {
  at?: PartitionTimeValue;
  timeZone?: string;
  suffix?: string | null;
  sanitizeSuffix?: PartitionSanitizer | false;
};

type CreatePartitionOptions = {
  temporary?: boolean;
};

type SetPartitionOptions = {
  temporary?: boolean;
};

type PromotePartitionOptions = {
  merge?: boolean;
};

type PartitionTotals = {
  logs: number;
  dirs: number;
  files: number;
  bytes: number;
};

type PartitionInfo = {
  name: string;
  path: string;
  temporary: boolean;
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
  total: PartitionTotals;
};

type RenamePartitionOptions = {
  from: string;
  to: string;
};

type MovePartitionOptions = {
  fromDir: string;
  from: string;
  toDir: string;
  to?: string;
};

type CopyPartitionOptions = {
  fromDir: string;
  from: string;
  toDir: string;
  to?: string;
};

type MergePartitionOptions = {
  from: string;
  to: string;
};

type DeletePartitionsOptions = {
  partitions?: string[];
  temporaryOnly?: boolean;
  olderThanDays?: number;
};

type DeletePartitionResult = {
  partitions: number;
  files: number;
  logs: number;
  bytes: number;
  items: string[];
};

type DeleteLogsOptions = {
  partition?: string | null;
  acrossPartitions?: boolean;
  groupKey?: string;
  day?: string;
  hour?: string;
  level?: string;
  olderThanDays?: number;
  temporaryOnly?: boolean;
};

type DeleteLogFileSummary = {
  path: string;
  partition: string | null;
  logs: number;
  bytes: number;
};

type DeleteLogsResult = {
  partitions: number;
  files: number;
  logs: number;
  bytes: number;
  items: DeleteLogFileSummary[];
};

export type {
  CopyPartitionOptions,
  CreatePartitionOptions,
  DeleteLogFileSummary,
  DeleteLogsOptions,
  DeleteLogsResult,
  DeletePartitionResult,
  DeletePartitionsOptions,
  MergePartitionOptions,
  MovePartitionOptions,
  PartitionInfo,
  PartitionNameOptions,
  PartitionSanitizeOptions,
  PartitionSanitizer,
  PartitionTimeValue,
  PartitionTotals,
  PromotePartitionOptions,
  RenamePartitionOptions,
  SetPartitionOptions,
};
