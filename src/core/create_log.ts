import path from "node:path";

import { createCommonLogger } from "./shared.js";
import { formatConsole, writeConsole } from "../format/console.js";
import { normalizeConsoleOptions } from "../format/options.js";
import { normalizeLevels } from "../levels/index.js";
import { buildRequestMiddleware } from "../middleware/request.js";
import { logStream } from "../stream/index.js";
import { exportPartition as exportStoredPartition, exportPartitions as exportStoredPartitions } from "../storage/export.js";
import { normalizePartitionKey, sanitizePartitionName } from "../storage/names.js";
import {
  getPartitionInfo as getStoredPartitionInfo,
  listPartitions as listStoredPartitions,
  mergePartition,
  renamePartition,
  touchPartitionMarkerSync,
} from "../storage/partitions.js";
import { getLogsForDir } from "../storage/query.js";
import { normalizeRetentionOptions, normalizeWriteOptions } from "../storage/options.js";
import { FileWriter } from "../storage/write.js";
import type { CreateLogOptions, LogInstance } from "../types.js";
import { normalizeTimeZone } from "../utils/datetime.js";
import { maybeShowNodeRuntimeNotice } from "../utils/runtime.js";
import { toString } from "../utils/values.js";

let packageGreetingShown = false;

function safeResolveDir(value: unknown): string {
  const raw = toString(value);
  return raw ? path.resolve(raw) : "";
}

function createLog(options: CreateLogOptions = {}): LogInstance {
  const cfg = options && typeof options === "object" ? options : {};
  maybeShowNodeRuntimeNotice(cfg.quiet);
  const levels = normalizeLevels(cfg.levels);
  const consoleOptions = normalizeConsoleOptions(cfg.console);
  const timeZone = normalizeTimeZone(cfg.timeZone);
  let activePartition = normalizePartitionKey(cfg.partition) || null;
  let activeTemporary = cfg.temporaryPartition === true;

  const writer = new FileWriter({
    dir: safeResolveDir(cfg.dir),
    save: typeof cfg.save === "boolean" ? cfg.save : Boolean(toString(cfg.dir)),
    write: normalizeWriteOptions(cfg.write),
    retention: normalizeRetentionOptions(cfg.retention),
    timeZone,
    onError: (message) => writeConsole("stderr", message),
  });

  if (activePartition && activeTemporary && writer.isSavingEnabled() && writer.getDir()) {
    touchPartitionMarkerSync(writer.getDir(), activePartition, { temporary: true });
  }

  const { api: baseApi } = createCommonLogger({
    levels,
    minLevel: cfg.minLevel,
    defaultSource: cfg.source,
    serializers: cfg.serializers,
    redact: cfg.redact,
    sample: cfg.sample,
    getPartition: () => activePartition,
    writeEntry(entry, levelConfig) {
    if (consoleOptions.enabled) writeConsole(levelConfig.stream, formatConsole(entry, levelConfig, consoleOptions, timeZone));
    writer.write(entry);

    try {
      logStream.emit("log", entry, { runtime: "server", dir: writer.getDir() });
    } catch {}
    },
    flush() {
      return writer.flush();
    },
    close() {
      return writer.close();
    },
    getStats() {
      return writer.getStats();
    },
  });
  const api = baseApi as LogInstance;

  Object.assign(api, {
    getDir() {
      return writer.getDir();
    },
    setDir(nextDir: string) {
      writer.setDir(safeResolveDir(nextDir));
      if (activePartition && activeTemporary && writer.isSavingEnabled() && writer.getDir()) {
        touchPartitionMarkerSync(writer.getDir(), activePartition, { temporary: true });
      }
    },
    getPartition() {
      return activePartition;
    },
    async setPartition(partition, options) {
      const hasTemporary = Object.prototype.hasOwnProperty.call(options || {}, "temporary");
      const nextPartition = partition == null ? null : sanitizePartitionName(String(partition));
      const samePartition = nextPartition === activePartition;
      const nextTemporary = nextPartition
        ? (hasTemporary ? options?.temporary === true : (samePartition ? activeTemporary : false))
        : false;

      await writer.flush();
      activePartition = nextPartition;
      activeTemporary = nextTemporary;

      if (activePartition && writer.isSavingEnabled() && writer.getDir()) {
        touchPartitionMarkerSync(writer.getDir(), activePartition, {
          temporary: activeTemporary,
        });
      }
    },
    async promotePartition(partition, options) {
      if (!activePartition) throw new Error("partition-not-set");
      const nextPartition = sanitizePartitionName(partition);
      await writer.flush();

      if (!writer.isSavingEnabled() || !writer.getDir()) {
        activePartition = nextPartition;
        activeTemporary = false;
        return;
      }

      if (nextPartition === activePartition) {
        touchPartitionMarkerSync(writer.getDir(), nextPartition, { temporary: false });
        activeTemporary = false;
        return;
      }

      const sourceInfo = await getStoredPartitionInfo(writer.getDir(), activePartition);
      const targetInfo = await getStoredPartitionInfo(writer.getDir(), nextPartition);

      if (!sourceInfo) {
        if (targetInfo && options?.merge !== true) throw new Error(`partition-already-exists: ${nextPartition}`);
      } else if (targetInfo) {
        if (options?.merge !== true) throw new Error(`partition-already-exists: ${nextPartition}`);
        await mergePartition(writer.getDir(), { from: activePartition, to: nextPartition });
      } else {
        await renamePartition(writer.getDir(), { from: activePartition, to: nextPartition });
      }

      touchPartitionMarkerSync(writer.getDir(), nextPartition, { temporary: false });
      activePartition = nextPartition;
      activeTemporary = false;
    },
    async listPartitions() {
      return listStoredPartitions(writer.getDir());
    },
    async exportPartition(partitionOrOptions, maybeOptions) {
      await writer.flush();
      const hasPartitionArg = typeof partitionOrOptions === "string";
      const partition = hasPartitionArg ? sanitizePartitionName(partitionOrOptions) : activePartition;
      const options = (hasPartitionArg
        ? maybeOptions
        : (partitionOrOptions && typeof partitionOrOptions === "object" ? partitionOrOptions : maybeOptions)) || {};
      if (!partition) throw new Error("partition-not-set");
      return exportStoredPartition(writer.getDir(), partition, options);
    },
    async exportPartitions(options) {
      await writer.flush();
      return exportStoredPartitions(writer.getDir(), options || {});
    },
    async getPartitionInfo(partition) {
      const target = partition == null ? activePartition : sanitizePartitionName(partition);
      if (!target) return null;
      return getStoredPartitionInfo(writer.getDir(), target);
    },
    async getAllLogs(options) {
      await writer.flush();
      const query = {
        ...(options || {}),
        levels,
      } as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(options || {}, "partition")) query.partition = options?.partition ?? null;
      else if (activePartition) query.partition = activePartition;
      return getLogsForDir(writer.getDir(), query);
    },
    async getAllLogsAcrossPartitions(options) {
      await writer.flush();
      return getLogsForDir(writer.getDir(), { ...(options || {}), acrossPartitions: true, levels });
    },
  });

  api.requestLogger = buildRequestMiddleware(api, cfg.request);

  if (cfg.quiet !== true && !packageGreetingShown) {
    packageGreetingShown = true;
    api.success("logger.loader", "@trebired/logger initialized");
  }

  return api;
}

export { createLog };
