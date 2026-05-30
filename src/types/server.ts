import type { ConsoleOptions, LogEntry, LogLevelConfig, RedactOptions, RequestLoggerOptions, RetentionOptions, ServerLogStreamContext, WriteOptions } from "./common.js";
import type { ExportPartitionOptions, ExportPartitionsOptions, ExportResult } from "./export.js";
import type { PartitionInfo, PartitionListResult, PromotePartitionOptions, SetPartitionOptions } from "./partitions.js";
import type { LogQueryOptions, LogQueryResult } from "./query.js";

type CreateLogOptions = {
  dir?: string;
  partition?: string;
  temporaryPartition?: boolean;
  save?: boolean;
  console?: boolean | ConsoleOptions;
  quiet?: boolean;
  timeZone?: string;
  source?: string;
  levels?: Record<string, LogLevelConfig>;
  minLevel?: string | number;
  write?: WriteOptions;
  retention?: RetentionOptions;
  redact?: RedactOptions;
  serializers?: Record<string, (value: unknown) => unknown>;
  sample?: number | ((entry: LogEntry) => boolean);
  request?: RequestLoggerOptions;
};

type LogStats = {
  mode: "async" | "sync";
  queued: number;
  written: number;
  dropped: number;
  failed: number;
  queueLength: number;
  closed: boolean;
};

type LogInstance = Record<string, any> & {
  group(groupName?: string): Record<string, any>;
  withScope(source?: string | null, groupName?: string, instance?: string | number | null): Record<string, any>;
  setEnabled(flag: boolean): void;
  getDir(): string;
  setDir(nextDir: string): void;
  getPartition(): string | null;
  setPartition(partition: string | null, options?: SetPartitionOptions): Promise<void>;
  promotePartition(partition: string, options?: PromotePartitionOptions): Promise<void>;
  exportPartition(partition?: string, options?: Omit<ExportPartitionOptions, "outputPath"> & { outputPath: string }): Promise<ExportResult>;
  exportPartitions(options: Omit<ExportPartitionsOptions, "outputPath"> & { outputPath: string }): Promise<ExportResult>;
  listPartitions(): Promise<PartitionListResult>;
  getPartitionInfo(partition?: string): Promise<PartitionInfo | null>;
  requestLogger(options?: RequestLoggerOptions): (req: any, res: any, next: () => void) => void;
  logError(error: unknown, metadata?: Record<string, unknown>, source?: string): void;
  getAllLogs(options?: LogQueryOptions): Promise<LogQueryResult>;
  getAllLogsAcrossPartitions(options?: LogQueryOptions): Promise<LogQueryResult>;
  flush(): Promise<void>;
  close(): Promise<void>;
  getStats(): LogStats;
};

type NormalizedConsoleOptions = {
  enabled: boolean;
  colors: boolean;
  timestamp: boolean;
  group: boolean;
  metadata: boolean;
  locale?: string;
};

type NormalizedWriteOptions = {
  mode: "async" | "sync";
  maxQueue: number;
  overflow: "drop-newest" | "drop-oldest" | "throw";
};

type NormalizedRetentionOptions = {
  enabled: boolean;
  maxAgeDays: number | null;
  maxPartitions: number | null;
  maxFileSize: number;
  compressOldFiles: boolean;
  cleanupIntervalMs: number;
};

export type {
  CreateLogOptions,
  LogInstance,
  LogStats,
  NormalizedConsoleOptions,
  NormalizedRetentionOptions,
  NormalizedWriteOptions,
  ServerLogStreamContext,
};
