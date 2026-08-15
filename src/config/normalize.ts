import type { CreateLogOptions } from "#4riod1305goy";
import type {
  LoggerConfig,
  LoggerDefaultOptions,
  NormalizedLoggerConfig,
} from "./types.js";
import { normGroup } from "#8xmnu037caa7";
import { PACKAGE_VERSION } from "#qz1iteme01ng";
import {
  isRecord,
  toTrimmedString as toString,
} from "@trebired/utils";
import { resolveForVersion } from "@trebired/utils";

type NormalizeOptions = {
  configPath?: string;
  requireForVersion?: boolean;
};

function defineConfig<TConfig extends LoggerConfig>(config: TConfig): TConfig {
  return config;
}

function normalizeConfig(
  config: LoggerConfig = {},
  options: NormalizeOptions = {},
): NormalizedLoggerConfig {
  if (!isRecord(config)) throw new Error("logger config must be an object");
  return {
    defaults: normalizeDefaultOptions(config.defaults),
    forVersion: normalizeForVersion(config, options),
    prefix: normalizePrefix(config.prefix),
  };
}

function mergeCreateLogOptions(
  defaults: LoggerDefaultOptions | undefined,
  options: CreateLogOptions,
): CreateLogOptions {
  if (!defaults || Object.keys(defaults).length === 0) return options;
  return {
    ...defaults,
    ...options,
    console: mergeConsoleOptions(defaults.console, options.console),
    levels: mergeRecord(defaults.levels, options.levels),
    redact: mergeObject(defaults.redact, options.redact),
    request: mergeObject(defaults.request, options.request),
    retention: mergeObject(defaults.retention, options.retention),
    serializers: mergeRecord(defaults.serializers, options.serializers),
    write: mergeObject(defaults.write, options.write),
  };
}

function normalizeDefaultOptions(input: LoggerDefaultOptions | undefined): LoggerDefaultOptions {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return {
    console: input.console,
    levels: cloneRecord(input.levels),
    minLevel: input.minLevel,
    quiet: input.quiet,
    redact: cloneObject(input.redact),
    request: cloneObject(input.request),
    retention: cloneObject(input.retention),
    serializers: cloneRecord(input.serializers),
    timeZone: input.timeZone,
    write: cloneObject(input.write),
  };
}

function normalizePrefix(input: LoggerConfig["prefix"]): false | string {
  if (input === false) return false;
  const raw = toString(input);
  if (!raw) return false;
  const normalized = normGroup(raw).key;

  return normalized || false;
}

function normalizeForVersion(
  config: LoggerConfig,
  options: NormalizeOptions,
): string {
  return resolveForVersion({
      configPath: options.configPath,
      forVersion: config.forVersion,
      label: "logger",
      packageVersion: PACKAGE_VERSION,
      requireForVersion: options.requireForVersion,
  });
}

function mergeConsoleOptions(
  defaults: LoggerDefaultOptions["console"],
  value: LoggerDefaultOptions["console"],
): LoggerDefaultOptions["console"] {
  if (value === undefined) return cloneConsoleOptions(defaults);
  if (typeof value === "boolean") return value;
  if (typeof defaults === "boolean" || !defaults) return cloneObject(value);
  return mergeObject(defaults, value);
}

function cloneConsoleOptions(
  value: LoggerDefaultOptions["console"],
): LoggerDefaultOptions["console"] {
  if (typeof value === "boolean" || value === undefined) return value;
  return cloneObject(value);
}

function mergeRecord<TValue>(
  defaults: Record<string, TValue>|undefined,
  value: Record<string, TValue>|undefined,
): Record<string, TValue>|undefined {
  if (!defaults && !value) return undefined;
  return { ...(defaults || {}), ...(value || {}) };
}

function cloneRecord<TValue>(value: Record<string, TValue>|undefined): Record<string, TValue>|undefined {
  return value ? { ...value } : undefined;
}

function mergeObject<TValue extends object>(
  defaults: TValue | undefined,
  value: TValue | undefined,
): TValue | undefined {
  if (!defaults && !value) return undefined;
  return { ...(defaults || {}), ...(value || {}) } as TValue;
}

function cloneObject<TValue extends object>(value: TValue | undefined): TValue | undefined {
  return value ? { ...value } : undefined;
}

export {
  defineConfig,
  mergeCreateLogOptions,
  normalizeConfig,
};
