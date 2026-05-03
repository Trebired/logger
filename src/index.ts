export { TOP_LEVEL, DEFAULT_LEVELS as defaultLevels } from "./constants.js";
export { createLog } from "./core/create_log.js";
export { normalizeLevels } from "./levels/index.js";
export { getEntriesForDir } from "./storage/query.js";
export { logStream } from "./stream/index.js";

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
  RedactOptions,
  RedactTransformArgs,
  RequestLoggerOptions,
  RetentionOptions,
  WriteOptions,
} from "./types.js";
