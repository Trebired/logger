import type {
  ConsoleOptions,
  LogLevelConfig,
  RedactOptions,
  RequestLoggerOptions,
  RetentionOptions,
  WriteOptions,
} from "#0ns6umc1i7ld";

type LoggerDefaultOptions = {
  console?: boolean | ConsoleOptions;
  levels?: Record<string, LogLevelConfig>;
  minLevel?: string | number;
  quiet?: boolean;
  redact?: RedactOptions;
  request?: RequestLoggerOptions;
  retention?: RetentionOptions;
  serializers?: Record<string, (value:unknown)=>unknown>;
  timeZone?: string;
  write?: WriteOptions;
};

type LoggerConfig = {
  defaults?: LoggerDefaultOptions;
  prefix?: false | string;
};

type NormalizedLoggerConfig = {
  defaults: LoggerDefaultOptions;
  prefix: false | string;
};

type LoadedLoggerConfig = {
  config: NormalizedLoggerConfig;
  configPath: string | null;
  dependencies: string[];
};

type LoadLoggerConfigOptions = {
  configPath?: string;
  defaultIfMissing?: boolean;
  searchFrom?: string;
};

export type {
  LoadLoggerConfigOptions,
  LoadedLoggerConfig,
  LoggerConfig,
  LoggerDefaultOptions,
  NormalizedLoggerConfig,
};
