export {
  defineConfig,
  mergeCreateLogOptions,
  normalizeConfig,
} from "./normalize.js";
export {
  LOGGER_PROJECT_CONFIG_PATH,
  findConfig,
  findConfigSync,
  loadCachedConfigSync,
  loadConfig,
  loadConfigSync,
  resetConfigCacheForTests,
} from "./load.js";

export type {
  LoadLoggerConfigOptions,
  LoadedLoggerConfig,
  LoggerConfig,
  LoggerDefaultOptions,
  NormalizedLoggerConfig,
} from "./types.js";
