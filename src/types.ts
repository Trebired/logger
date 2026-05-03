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

type CreateLogOptions = {
  dir?: string;
  save?: boolean;
  console?: boolean | ConsoleOptions;
  quiet?: boolean;
  timeZone?: string;
  source?: string;
  defaultGroup?: string;
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
  metadata?: Record<string, unknown>;
};

type LogQueryOptions = {
  level?: string;
  groupKey?: string;
  day?: string;
  hour?: string;
  limit?: number;
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
  requestLogger(options?: RequestLoggerOptions): (req: any, res: any, next: () => void) => void;
  logError(error: unknown, metadata?: Record<string, unknown>, source?: string): void;
  getAll(options?: LogQueryOptions): Promise<LogEntry[]>;
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
  maxAgeDays: number;
  maxFileSize: number;
  compressOldFiles: boolean;
  cleanupIntervalMs: number;
};

export type {
  ConsoleOptions,
  CreateLogOptions,
  LogEntry,
  LogInstance,
  LogLevelConfig,
  LogOrigin,
  LogQueryOptions,
  LogStats,
  LogStreamName,
  NormalizedConsoleOptions,
  NormalizedRetentionOptions,
  NormalizedWriteOptions,
  RedactOptions,
  RedactTransformArgs,
  RequestLoggerOptions,
  RetentionOptions,
  WriteOptions,
};
