import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  LoadLoggerConfigOptions,
  LoadedLoggerConfig,
  LoggerConfig,
  NormalizedLoggerConfig,
} from "./types.js";
import { normalizeConfig } from "./normalize.js";

const WORKSPACE_CONFIG_DIR = ".trebired";
const LOGGER_PROJECT_CONFIG_PATH = `${WORKSPACE_CONFIG_DIR}/logger/config.ts`;
const EMPTY_CONFIG = Object.freeze(normalizeConfig({}));

let cachedConfig: LoadedLoggerConfig | null = null;

async function loadConfig(
  projectRoot = process.cwd(),
  options: LoadLoggerConfigOptions = {},
): Promise<LoadedLoggerConfig> {
  const root = path.resolve(projectRoot);
  const configPath = options.configPath
  ? path.resolve(root, options.configPath)
  : await findConfig(options.searchFrom || root, root);

  if (!configPath) {
    if (options.defaultIfMissing === false) throw new Error("logger config was not found");
    return missingConfig();
  }

  if (!await pathExists(configPath)) {
    throw new Error(`logger config was not found: ${configPath}`);
  }

  const imported = await import(pathToFileURL(configPath).href);
  return loadedConfig(configPath, readDefaultConfig(imported, configPath));
}

function loadConfigSync(
  projectRoot = process.cwd(),
  options: LoadLoggerConfigOptions = {},
): LoadedLoggerConfig {
  const root = path.resolve(projectRoot);
  const configPath = options.configPath
  ? path.resolve(root, options.configPath)
  : findConfigSync(options.searchFrom || root, root);

  if (!configPath) {
    if (options.defaultIfMissing === false) throw new Error("logger config was not found");
    return missingConfig();
  }

  if (!fs.existsSync(configPath)) {
    throw new Error(`logger config was not found: ${configPath}`);
  }

  const requireFromConfig = createRequire(pathToFileURL(configPath).href);
  return loadedConfig(configPath, readDefaultConfig(requireFromConfig(configPath), configPath));
}

function loadCachedConfigSync(projectRoot = process.cwd()): NormalizedLoggerConfig {
  const configPath = findConfigSync(projectRoot, projectRoot);
  if (cachedConfig && cachedConfig.configPath === configPath) return cachedConfig.config;
  cachedConfig = configPath ? loadConfigSync(projectRoot, { configPath }) : missingConfig();
  return cachedConfig.config;
}

function resetConfigCacheForTests(): void {
  cachedConfig = null;
}

async function findConfig(startDir = process.cwd(), boundaryDir?: string): Promise<string|null> {
  let current = path.resolve(startDir);
  const boundary = boundaryDir ? path.resolve(boundaryDir) : "";

  for (;; ) {
    const candidate = path.join(current, LOGGER_PROJECT_CONFIG_PATH);
    if (await pathExists(candidate)) return candidate;
    if (boundary && current === boundary) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function findConfigSync(startDir = process.cwd(), boundaryDir?: string): string | null {
  let current = path.resolve(startDir);
  const boundary = boundaryDir ? path.resolve(boundaryDir) : "";

  for (;; ) {
    const candidate = path.join(current, LOGGER_PROJECT_CONFIG_PATH);
    if (fs.existsSync(candidate)) return candidate;
    if (boundary && current === boundary) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return true;
  }
  catch {
    return false;
  }
}

function missingConfig(): LoadedLoggerConfig {
  return { config: EMPTY_CONFIG, configPath: null, dependencies: [] };
}

function loadedConfig(configPath: string, config: LoggerConfig): LoadedLoggerConfig {
  return {
    config: normalizeConfig(config),
    configPath,
    dependencies: [configPath],
  };
}

function readDefaultConfig(imported: unknown, configPath: string): LoggerConfig {
  const candidate = imported && typeof imported === "object"
  ? (imported as { default?: unknown }).default
  : undefined;

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`logger config must default-export an object: ${configPath}`);
  }

  return candidate as LoggerConfig;
}

export {
  LOGGER_PROJECT_CONFIG_PATH,
  findConfig,
  findConfigSync,
  loadCachedConfigSync,
  loadConfig,
  loadConfigSync,
  resetConfigCacheForTests,
};
