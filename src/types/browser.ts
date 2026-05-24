import type { BrowserTransportContext, ConsoleOptions, LogEntry, LogLevelConfig, RedactOptions } from "./common.js";

type BrowserBatchOptions = {
  size?: number;
  delayMs?: number;
  maxQueue?: number;
  overflow?: "drop-newest" | "drop-oldest" | "throw";
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

type BrowserLogInstance = Record<string, any> & {
  group(groupName?: string): Record<string, any>;
  withScope(source?: string | null, groupName?: string, instance?: string | number | null): Record<string, any>;
  setEnabled(flag: boolean): void;
  logError(error: unknown, metadata?: Record<string, unknown>, source?: string): void;
  flush(): Promise<void>;
  close(): Promise<void>;
  getStats(): BrowserLogStats;
};

export type {
  BrowserBatchOptions,
  BrowserConsoleTransportOptions,
  BrowserLogInstance,
  BrowserLogOptions,
  BrowserLogStats,
  BrowserTransport,
};
