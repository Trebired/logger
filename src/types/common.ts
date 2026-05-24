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

type LogStreamHandler = (entry: LogEntry, context: LogStreamContext) => void;

type ServerLogStreamContext = {
  runtime: "server";
  dir: string;
};

type BrowserTransportContext = {
  runtime: "browser";
  transports: string[];
};

type BrowserLogStreamContext = BrowserTransportContext;

type LogStreamContext = ServerLogStreamContext | BrowserLogStreamContext;

export type {
  BrowserLogStreamContext,
  BrowserTransportContext,
  ConsoleOptions,
  LogEntry,
  LogLevelConfig,
  LogOrigin,
  LogStreamContext,
  LogStreamHandler,
  LogStreamName,
  RedactOptions,
  RedactTransformArgs,
  RequestLoggerOptions,
  RetentionOptions,
  ServerLogStreamContext,
  WriteOptions,
};
