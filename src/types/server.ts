import type {
  ConsoleOptions,
  LogEntry,
  LogLevelConfig,
  RedactOptions,
  RequestLoggerOptions,
  RetentionOptions,
  ServerLogStreamContext,
  WriteOptions,
} from "./common.js";
import type {
  ExportLogsOptions,
  ExportLogsResult,
  FinalizePartitionOptions,
  FinalizePartitionResult,
  ListGroupsOptions,
  LogGroupSummary,
  LogQueryOptions,
  LogQueryResult,
  PartitionInfo,
  PartitionListResult,
  RetentionRunResult,
  SetPartitionOptions,
  SnapshotStoreOptions,
  SnapshotStoreResult,
} from "./store.js";

type CreateLogOptions = {
  dir?: string;
  partition?: string;
  temporaryPartition?: boolean;
  save?: boolean;
  prefix?: false | string;
  console?: boolean | ConsoleOptions;
  quiet?: boolean;
  timeZone?: string;
  source?: string;
  levels?: Record<string, LogLevelConfig>;
  minLevel?: string | number;
  write?: WriteOptions;
  retention?: RetentionOptions;
  redact?: RedactOptions;
  serializers?: Record<string, (value:unknown)=>unknown>;
  sample?: number | ((entry: LogEntry) => boolean);
  request?: RequestLoggerOptions;
};

type LogStats = {
  mode: "async" | "sync";
  queued: number;
  written: number;
  dropped: number;
  failed: number;
  batches: number;
  queueLength: number;
  closed: boolean;
};

type LogInstance = Record<string, any>& {
  group(groupName?: string): Record<string, any>;
  withScope(
    source?: string | null,
    groupName?: string,
    instance?: string | number | null,
  ): Record<string, any>;
  setEnabled(flag: boolean): void;
  getDir(): string;
  setDir(nextDir: string): void;
  getPartition(): string | null;
  setPartition(
    partition: string | null,
    options?: SetPartitionOptions,
  ): Promise<void>;
  finalizePartition(
    partition: string,
    options?: FinalizePartitionOptions,
  ): Promise<FinalizePartitionResult>;
  getPartitionInfo(partition?: string): Promise<PartitionInfo|null>;
  listPartitions(): Promise<PartitionListResult>;
  queryLogs(options?: LogQueryOptions): Promise<LogQueryResult>;
  listGroups(options?: ListGroupsOptions): Promise<LogGroupSummary[]>;
  exportLogs(options: ExportLogsOptions): Promise<ExportLogsResult>;
  snapshotStore(options: SnapshotStoreOptions): Promise<SnapshotStoreResult>;
  runRetention(): Promise<RetentionRunResult|null>;
  requestLogger(
    options?: RequestLoggerOptions,
  ): (req: any, res: any, next: () => void) => void;
  logError(
    error: unknown,
    metadata?: Record<string, unknown>,
    source?: string,
  ): void;
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
  batchSize: number;
  flushIntervalMs: number;
  maxQueue: number;
  overflow: "drop-newest" | "drop-oldest" | "throw";
};

type NormalizedRetentionOptions = {
  enabled: boolean;
  maxAgeMs: number | null;
  maxSizeBytes: number | null;
  intervalMs: number;
  temporaryMaxIdleMs: number;
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
