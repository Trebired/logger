type LogStreamName = "stdout" | "stderr";

type LogLevelConfig = {
  weight: number;
  label?: string;
  color?: string;
  stream?: LogStreamName;
  showStack?: boolean;
  bold?: boolean;
};

type ConsoleOptions = {
  enabled?: boolean;
  colors?: boolean;
  timestamp?: boolean;
  group?: boolean;
  metadata?: boolean;
  locale?: string;
};

type WriteOptions = {
  mode?: "async" | "sync";
  maxQueue?: number;
  overflow?: "drop-newest" | "drop-oldest" | "throw";
};

type RetentionOptions = {
  enabled?: boolean;
  maxAgeDays?: number;
  maxPartitions?: number;
  maxFileSize?: string | number;
  compressOldFiles?: boolean;
  cleanupIntervalMs?: number;
};

type RedactTransformArgs = {
  path: string;
  key: string;
  value: unknown;
  replacement: string;
};

type RedactOptions = {
  paths?: Array<string | RegExp>;
  replacement?: string;
  includeDefaultSensitiveKeys?: boolean;
  transform?: (args: RedactTransformArgs) => unknown;
};

type RequestLoggerOptions = {
  group?: string;
  idHeader?: string;
  attach?: boolean;
};

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

type LogOrigin = {
  source: string;
  instance: string | null;
};

type LogEntry = {
  recorded_at: string;
  level: string;
  group: string;
  message: string;
  origin: LogOrigin;
  partition?: string | null;
  metadata?: Record<string, unknown>;
};

type LogQueryOptions = {
  level?: string;
  groupKey?: string;
  day?: string;
  hour?: string;
  limit?: number;
  partition?: string | null;
  acrossPartitions?: boolean;
  levels?: Record<string, LogLevelConfig>;
};

type LogQueryTotals = {
  logs: number;
  dirs: number;
  files: number;
};

type LogPartitionTotals = LogQueryTotals & {
  partitions: number;
};

type LogPartitionSummary = {
  partition: string | null;
  count: number;
  total: LogQueryTotals;
};

type LogQueryResult = {
  logs: LogEntry[];
  levels: Record<string, LogLevelConfig>;
  metadata: {
    dir: string;
    partition: string | null;
    count: number;
    total: LogQueryTotals;
    query: {
      level: string;
      groupKey: string;
      day: string;
      hour: string;
      limit: number;
      partition: string | null;
      acrossPartitions: boolean;
    };
    partitions: {
      items: LogPartitionSummary[];
      all: LogPartitionTotals;
    };
  };
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

type BrowserBatchOptions = {
  size?: number;
  delayMs?: number;
  maxQueue?: number;
  overflow?: "drop-newest" | "drop-oldest" | "throw";
};

type BrowserTransportContext = {
  runtime: "browser";
  transports: string[];
};

type BrowserTransport = {
  name: string;
  available?: () => boolean;
  write(entries: LogEntry[], context: BrowserTransportContext): void | Promise<void>;
  flush?(): void | Promise<void>;
  close?(): void | Promise<void>;
};

type BrowserConsoleTransportOptions = {
  console?: boolean | ConsoleOptions;
  timeZone?: string;
  levels?: Record<string, LogLevelConfig>;
};

type BrowserLogOptions = {
  console?: boolean | ConsoleOptions;
  quiet?: boolean;
  timeZone?: string;
  source?: string;
  group?: string;
  metadata?: Record<string, unknown>;
  levels?: Record<string, LogLevelConfig>;
  minLevel?: string | number;
  redact?: RedactOptions;
  serializers?: Record<string, (value: unknown) => unknown>;
  sample?: number | ((entry: LogEntry) => boolean);
  transports?: Array<"console" | BrowserTransport>;
  batch?: BrowserBatchOptions;
};

type BrowserLogStats = {
  queued: number;
  written: number;
  dropped: number;
  failed: number;
  queueLength: number;
  closed: boolean;
  transports: string[];
};

type ServerLogStreamContext = {
  runtime: "server";
  dir: string;
};

type BrowserLogStreamContext = BrowserTransportContext;

type LogStreamContext = ServerLogStreamContext | BrowserLogStreamContext;

type LogStreamHandler = (entry: LogEntry, context: LogStreamContext) => void;

type BrowserLogInstance = Record<string, any> & {
  group(groupName?: string): Record<string, any>;
  withScope(source?: string | null, groupName?: string, instance?: string | number | null): Record<string, any>;
  setEnabled(flag: boolean): void;
  logError(error: unknown, metadata?: Record<string, unknown>, source?: string): void;
  flush(): Promise<void>;
  close(): Promise<void>;
  getStats(): BrowserLogStats;
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
  listPartitions(): Promise<PartitionInfo[]>;
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
  BrowserBatchOptions,
  BrowserConsoleTransportOptions,
  BrowserLogInstance,
  BrowserLogOptions,
  BrowserLogStats,
  BrowserLogStreamContext,
  BrowserTransport,
  BrowserTransportContext,
  ConsoleOptions,
  CopyPartitionOptions,
  CreatePartitionOptions,
  CreateLogOptions,
  DeleteLogFileSummary,
  DeleteLogsOptions,
  DeleteLogsResult,
  DeletePartitionResult,
  DeletePartitionsOptions,
  LogEntry,
  LogInstance,
  LogLevelConfig,
  LogOrigin,
  LogQueryOptions,
  LogQueryResult,
  LogQueryTotals,
  LogPartitionTotals,
  LogPartitionSummary,
  LogStats,
  LogStreamContext,
  LogStreamHandler,
  LogStreamName,
  MergePartitionOptions,
  MovePartitionOptions,
  NormalizedConsoleOptions,
  NormalizedRetentionOptions,
  NormalizedWriteOptions,
  PartitionInfo,
  PartitionNameOptions,
  PartitionSanitizeOptions,
  PartitionSanitizer,
  PartitionTimeValue,
  PartitionTotals,
  PromotePartitionOptions,
  RedactOptions,
  RedactTransformArgs,
  RenamePartitionOptions,
  RequestLoggerOptions,
  RetentionOptions,
  ServerLogStreamContext,
  SetPartitionOptions,
  WriteOptions,
};
