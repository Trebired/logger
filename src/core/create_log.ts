import path from "node:path";

import { formatConsole, normalizeConsoleOptions, writeConsole } from "../format/console.js";
import { normGroup } from "../groups.js";
import { minLevelWeight, normalizeLevel, normalizeLevels } from "../levels/index.js";
import { prepareMetadata } from "../metadata/process.js";
import { buildRequestMiddleware } from "../middleware/request.js";
import { logStream } from "../stream/index.js";
import { normalizePartitionKey } from "../storage/names.js";
import { getLogsForDir } from "../storage/query.js";
import { normalizeRetentionOptions, normalizeWriteOptions } from "../storage/options.js";
import { FileWriter } from "../storage/write.js";
import type { CreateLogOptions, LogEntry, LogInstance, LogOrigin } from "../types.js";
import { normalizeTimeZone } from "../utils/datetime.js";
import { maybeShowNodeRuntimeNotice } from "../utils/runtime.js";
import { asObject, toString } from "../utils/values.js";

let packageGreetingShown = false;
const DEFAULT_GROUP = "default";

function safeResolveDir(value: unknown): string {
  const raw = toString(value);
  return raw ? path.resolve(raw) : "";
}

function buildOrigin(source: unknown, instance: unknown = null): LogOrigin {
  const src = toString(source) || "app";
  const inst = instance == null ? null : String(instance);
  return {
    source: src,
    instance: inst || null,
  };
}

function parseCallArguments(argsLike: IArguments | unknown[], fallbackGroup: string) {
  const args = Array.isArray(argsLike) ? argsLike : Array.from(argsLike || []);
  const hasExplicitGroup = typeof args[0] === "string" && typeof args[1] === "string";

  return {
    group: hasExplicitGroup ? args[0] : fallbackGroup,
    message: hasExplicitGroup ? args[1] : String(args[0] ?? ""),
    metadata: hasExplicitGroup ? asObject(args[2]) : asObject(args[1]),
  };
}

function shouldKeepSample(entry: LogEntry, sample: CreateLogOptions["sample"]): boolean {
  if (sample == null) return true;
  if (typeof sample === "number") {
    if (!Number.isFinite(sample)) return true;
    if (sample <= 0) return false;
    if (sample >= 1) return true;
    return Math.random() < sample;
  }
  if (typeof sample === "function") {
    try {
      return sample(entry) === true;
    } catch {
      return false;
    }
  }
  return true;
}

function createLog(options: CreateLogOptions = {}): LogInstance {
  const cfg = options && typeof options === "object" ? options : {};
  maybeShowNodeRuntimeNotice(cfg.quiet);
  const levels = normalizeLevels(cfg.levels);
  const threshold = minLevelWeight(cfg.minLevel, levels);
  const consoleOptions = normalizeConsoleOptions(cfg.console);
  const timeZone = normalizeTimeZone(cfg.timeZone);
  const defaultSource = toString(cfg.source) || "app";
  const partition = normalizePartitionKey(cfg.partition);
  let loggingEnabled = true;
  let closed = false;

  const writer = new FileWriter({
    dir: safeResolveDir(cfg.dir),
    partition,
    save: typeof cfg.save === "boolean" ? cfg.save : Boolean(toString(cfg.dir)),
    write: normalizeWriteOptions(cfg.write),
    retention: normalizeRetentionOptions(cfg.retention),
    timeZone,
    onError: (message) => writeConsole("stderr", message),
  });

  function emit(levelInput: string, groupInput: unknown, messageInput: unknown, metadataInput?: unknown, originInput?: Partial<LogOrigin>): void {
    if (!loggingEnabled || closed) return;

    const level = normalizeLevel(levelInput, levels);
    const levelConfig = levels[level] || levels.info;
    if (levelConfig.weight < threshold) return;

    const rawMetadata = asObject(metadataInput);
    const recordedAt = toString(rawMetadata.__recorded_at) || new Date().toISOString();
    const metadata = prepareMetadata(rawMetadata, cfg.serializers, cfg.redact);
    const group = normGroup(groupInput || DEFAULT_GROUP).key;
    const message = typeof messageInput === "string" ? messageInput : String(messageInput ?? "");
    const originSource = originInput && originInput.source ? originInput.source : defaultSource;
    const originInstance = originInput && Object.prototype.hasOwnProperty.call(originInput, "instance") ? originInput.instance : null;
    const entry: LogEntry = {
      recorded_at: recordedAt,
      level,
      group,
      message,
      origin: buildOrigin(originSource, originInstance),
      partition: partition || null,
    };
    if (Object.keys(metadata).length) entry.metadata = metadata;

    if (!shouldKeepSample(entry, cfg.sample)) return;

    if (consoleOptions.enabled) writeConsole(levelConfig.stream, formatConsole(entry, levelConfig, consoleOptions, timeZone));
    writer.write(entry);

    try {
      logStream.emit("log", entry, { dir: writer.getDir() });
    } catch {}
  }

  function logWith(level: string) {
    return function levelLogger(this: unknown): void {
      const parsed = parseCallArguments(arguments, DEFAULT_GROUP);
      emit(level, parsed.group, parsed.message, parsed.metadata);
    };
  }

  function bindGroup(groupName: unknown, originInput?: Partial<LogOrigin>): Record<string, any> {
    const boundGroup = normGroup(groupName || DEFAULT_GROUP).key;
    const grouped: Record<string, any> = {};

    for (const level of Object.keys(levels)) {
      grouped[level] = (message: unknown, metadata?: unknown) => emit(level, boundGroup, message, metadata, originInput);
    }

    grouped.child = (extraMetadata?: unknown) => {
      const extra = asObject(extraMetadata);
      const child: Record<string, any> = {};
      for (const level of Object.keys(levels)) {
        child[level] = (message: unknown, metadata?: unknown) => emit(level, boundGroup, message, { ...asObject(metadata), ...extra }, originInput);
      }
      return child;
    };

    return grouped;
  }

  const api: LogInstance = {
    group(groupName?: string) {
      return bindGroup(groupName || DEFAULT_GROUP);
    },
    withScope(source?: string | null, groupName?: string, instance?: string | number | null) {
      const originInput = {
        source: toString(source) || defaultSource,
        instance: instance == null ? null : String(instance),
      };
      return bindGroup(groupName || DEFAULT_GROUP, originInput);
    },
    setEnabled(flag: boolean) {
      loggingEnabled = Boolean(flag);
    },
    getDir() {
      return writer.getDir();
    },
    setDir(nextDir: string) {
      writer.setDir(safeResolveDir(nextDir));
    },
    requestLogger: buildRequestMiddleware(null, cfg.request),
    logError(error: unknown, metadata?: Record<string, unknown>, source?: string) {
      const meta = asObject(metadata);
      const groupName = toString(meta.group) || DEFAULT_GROUP;
      const originSource = toString(source) || defaultSource;
      if (error instanceof Error) {
        emit("error", groupName, error.message, { ...meta, stack: error.stack }, { source: originSource });
        return;
      }
      emit("error", groupName, String(error), meta, { source: originSource });
    },
    async getAllLogs(options) {
      await writer.flush();
      return getLogsForDir(writer.getDir(), {
        ...(options || {}),
        partition: Object.prototype.hasOwnProperty.call(options || {}, "partition")
          ? options?.partition
          : partition || undefined,
        levels,
      });
    },
    async getAllLogsAcrossPartitions(options) {
      await writer.flush();
      return getLogsForDir(writer.getDir(), { ...(options || {}), acrossPartitions: true, levels });
    },
    flush() {
      return writer.flush();
    },
    async close() {
      if (closed) return;
      closed = true;
      await writer.close();
    },
    getStats() {
      return writer.getStats();
    },
  };

  api.requestLogger = buildRequestMiddleware(api, cfg.request);

  for (const level of Object.keys(levels)) api[level] = logWith(level);

  if (cfg.quiet !== true && !packageGreetingShown) {
    packageGreetingShown = true;
    api.success("logger.loader", "@trebired/logger initialized");
  }

  return api;
}

export { createLog };
