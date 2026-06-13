import path from "node:path";

import { resolveConsoleVisibilityPolicy } from "../config/console_visibility.js";
import { createCommonLogger } from "./shared.js";
import { formatConsole, writeConsole } from "../format/console.js";
import { normalizeConsoleOptions } from "../format/options.js";
import { normalizeLevels } from "../levels/index.js";
import { buildRequestMiddleware } from "../middleware/request.js";
import { logStream } from "../stream/index.js";
import { activeStorageBackendNotice } from "../storage/backend/index.js";
import { exportPartition as exportStoredPartition, exportPartitions as exportStoredPartitions } from "../storage/export.js";
import { normalizePartitionKey, sanitizePartitionName } from "../storage/names.js";
import { deleteNonCurrentTemporaryPartitions } from "../storage/partitions/delete.js";
import { createPartitionError, isPartitionError } from "../storage/partitions/errors.js";
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
import type { CreateLogOptions, FinalizePartitionAction, FinalizePartitionOptions, FinalizePartitionResult, LogInstance, PartitionExistsPolicy, PromotePartitionOptions } from "../types.js";
import { normalizeTimeZone } from "../utils/datetime.js";
import { maybeShowNodeRuntimeNotice, writePackageNotice } from "../utils/runtime.js";
import { toString } from "../utils/values.js";

let packageGreetingShown = false;
let storageBackendNoticeShown = false;
const activeTemporaryPartitionsByDir = new Map<string, Set<string>>();

function resetCreateLogStateForTests(): void {
  packageGreetingShown = false;
  storageBackendNoticeShown = false;
  activeTemporaryPartitionsByDir.clear();
}

function safeResolveDir(value: unknown): string {
  const raw = toString(value);
  return raw ? path.resolve(raw) : "";
}

function cleanupErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolvePartitionExistsPolicy(
  options: FinalizePartitionOptions | PromotePartitionOptions | undefined,
  fallback: PartitionExistsPolicy,
): PartitionExistsPolicy {
  if (options && typeof options === "object" && options.ifExists) return options.ifExists;
  if (options && typeof options === "object" && "merge" in options && options.merge === true) return "merge";
  return fallback;
}

function createLog(options: CreateLogOptions = {}): LogInstance {
  const cfg = options && typeof options === "object" ? options : {};
  maybeShowNodeRuntimeNotice(cfg.quiet);
  const levels = normalizeLevels(cfg.levels);
  const consoleOptions = normalizeConsoleOptions(cfg.console);
  const consoleVisibility = resolveConsoleVisibilityPolicy();
  if (consoleVisibility.warning) writePackageNotice(consoleVisibility.warning);
  const timeZone = normalizeTimeZone(cfg.timeZone);
  let activePartition = normalizePartitionKey(cfg.partition) || null;
  let activeTemporary = cfg.temporaryPartition === true;
  let bypassConsoleVisibility = false;

  const writer = new FileWriter({
    dir: safeResolveDir(cfg.dir),
    save: typeof cfg.save === "boolean" ? cfg.save : Boolean(toString(cfg.dir)),
    write: normalizeWriteOptions(cfg.write),
    retention: normalizeRetentionOptions(cfg.retention),
    timeZone,
    onError: (message) => writeConsole("stderr", message),
  });
  let registeredTemporaryPartition: { dir: string; partition: string } | null = null;

  function withConsoleVisibilityBypass<T>(fn: () => T): T {
    bypassConsoleVisibility = true;
    try {
      return fn();
    } finally {
      bypassConsoleVisibility = false;
    }
  }

  function unregisterTemporaryPartition(): void {
    if (!registeredTemporaryPartition) return;
    const current = activeTemporaryPartitionsByDir.get(registeredTemporaryPartition.dir);
    if (current) {
      current.delete(registeredTemporaryPartition.partition);
      if (current.size === 0) activeTemporaryPartitionsByDir.delete(registeredTemporaryPartition.dir);
    }
    registeredTemporaryPartition = null;
  }

  function registerTemporaryPartition(): void {
    unregisterTemporaryPartition();
    if (!activeTemporary || !activePartition || !writer.isSavingEnabled() || !writer.getDir()) return;
    const dir = writer.getDir();
    const current = activeTemporaryPartitionsByDir.get(dir) || new Set<string>();
    current.add(activePartition);
    activeTemporaryPartitionsByDir.set(dir, current);
    registeredTemporaryPartition = { dir, partition: activePartition };
  }

  function keepTemporaryPartitions(dir: string): string[] {
    return Array.from(activeTemporaryPartitionsByDir.get(dir) || []);
  }

  async function cleanupTemporaryPartitions(dir = writer.getDir()): Promise<void> {
    if (!writer.isSavingEnabled() || !dir) return;
    await deleteNonCurrentTemporaryPartitions(dir, keepTemporaryPartitions(dir));
  }

  function scheduleTemporaryPartitionCleanup(dir = writer.getDir()): void {
    if (!writer.isSavingEnabled() || !dir) return;
    void cleanupTemporaryPartitions(dir).catch((error) => {
      writeConsole("stderr", `[trebired.logger] temporary partition cleanup failed: ${cleanupErrorMessage(error)}`);
    });
  }

  async function applyActivePartition(nextPartition: string | null, nextTemporary: boolean): Promise<void> {
    unregisterTemporaryPartition();
    activePartition = nextPartition;
    activeTemporary = nextTemporary;

    if (activePartition && writer.isSavingEnabled() && writer.getDir()) {
      touchPartitionMarkerSync(writer.getDir(), activePartition, {
        temporary: activeTemporary,
      });
    }

    registerTemporaryPartition();
    await cleanupTemporaryPartitions();
  }

  function createFinalizePartitionResult(args: {
    action: FinalizePartitionAction;
    partition: string;
    previousPartition: string | null;
    sourceExisted: boolean;
    targetExisted: boolean;
    temporaryBefore: boolean;
  }): FinalizePartitionResult {
    return {
      partition: args.partition,
      previousPartition: args.previousPartition,
      action: args.action,
      sourceExisted: args.sourceExisted,
      targetExisted: args.targetExisted,
      temporaryBefore: args.temporaryBefore,
      temporaryAfter: false,
    };
  }

  async function finalizeActivePartition(
    partition: string,
    options: FinalizePartitionOptions | PromotePartitionOptions | undefined,
    fallbackPolicy: PartitionExistsPolicy,
  ): Promise<FinalizePartitionResult> {
    if (!activePartition) throw createPartitionError("partition-not-set");
    const nextPartition = sanitizePartitionName(partition);
    const previousPartition = activePartition;
    const temporaryBefore = activeTemporary;
    const ifExists = resolvePartitionExistsPolicy(options, fallbackPolicy);

    await writer.flush();

    if (!writer.isSavingEnabled() || !writer.getDir()) {
      if (nextPartition === activePartition) {
        const action: FinalizePartitionAction = activeTemporary ? "marked-permanent" : "already-finalized";
        activeTemporary = false;
        return createFinalizePartitionResult({
          action,
          partition: nextPartition,
          previousPartition,
          sourceExisted: false,
          targetExisted: false,
          temporaryBefore,
        });
      }

      activePartition = nextPartition;
      activeTemporary = false;
      return createFinalizePartitionResult({
        action: "activated-target",
        partition: nextPartition,
        previousPartition,
        sourceExisted: false,
        targetExisted: false,
        temporaryBefore,
      });
    }

    const dir = writer.getDir();

    if (nextPartition === activePartition) {
      touchPartitionMarkerSync(dir, nextPartition, { temporary: false });
      unregisterTemporaryPartition();
      activeTemporary = false;
      await cleanupTemporaryPartitions();
      return createFinalizePartitionResult({
        action: temporaryBefore ? "marked-permanent" : "already-finalized",
        partition: nextPartition,
        previousPartition,
        sourceExisted: true,
        targetExisted: true,
        temporaryBefore,
      });
    }

    let sourceInfo = await getStoredPartitionInfo(dir, activePartition);
    let targetInfo = await getStoredPartitionInfo(dir, nextPartition);
    const initialSourceExisted = Boolean(sourceInfo);
    const initialTargetExisted = Boolean(targetInfo);

    const activateTarget = async (action: FinalizePartitionAction): Promise<FinalizePartitionResult> => {
      await applyActivePartition(nextPartition, false);
      return createFinalizePartitionResult({
        action,
        partition: nextPartition,
        previousPartition,
        sourceExisted: initialSourceExisted,
        targetExisted: initialTargetExisted,
        temporaryBefore,
      });
    };

    if (!sourceInfo) {
      if (targetInfo) {
        if (ifExists === "error") {
          throw createPartitionError("partition-already-exists", { partition: nextPartition });
        }
        await applyActivePartition(nextPartition, false);
        return createFinalizePartitionResult({
          action: ifExists === "switch" ? "switched" : "activated-target",
          partition: nextPartition,
          previousPartition,
          sourceExisted: false,
          targetExisted: true,
          temporaryBefore,
        });
      }

      await applyActivePartition(nextPartition, false);
      return createFinalizePartitionResult({
        action: "activated-target",
        partition: nextPartition,
        previousPartition,
        sourceExisted: false,
        targetExisted: false,
        temporaryBefore,
      });
    }

    if (targetInfo) {
      if (ifExists === "switch") {
        return activateTarget("switched");
      }

      if (ifExists === "merge") {
        await mergePartition(dir, { from: activePartition, to: nextPartition });
        sourceInfo = await getStoredPartitionInfo(dir, activePartition);
        targetInfo = await getStoredPartitionInfo(dir, nextPartition);
        return activateTarget("merged");
      }

      throw createPartitionError("partition-already-exists", { partition: nextPartition });
    }

    try {
      await renamePartition(dir, { from: activePartition, to: nextPartition });
      sourceInfo = await getStoredPartitionInfo(dir, activePartition);
      targetInfo = await getStoredPartitionInfo(dir, nextPartition);
      return activateTarget("renamed");
    } catch (error) {
      if (!isPartitionError(error, "partition-already-exists")) throw error;

      sourceInfo = await getStoredPartitionInfo(dir, activePartition);
      targetInfo = await getStoredPartitionInfo(dir, nextPartition);

      if (!targetInfo) throw error;

      if (ifExists === "switch") {
        return activateTarget("switched");
      }

      if (ifExists === "merge" && sourceInfo) {
        await mergePartition(dir, { from: activePartition, to: nextPartition });
        await applyActivePartition(nextPartition, false);
        return createFinalizePartitionResult({
          action: "merged",
          partition: nextPartition,
          previousPartition,
          sourceExisted: true,
          targetExisted: true,
          temporaryBefore,
        });
      }

      throw error;
    }
  }

  if (activePartition && activeTemporary && writer.isSavingEnabled() && writer.getDir()) {
    touchPartitionMarkerSync(writer.getDir(), activePartition, { temporary: true });
  }
  registerTemporaryPartition();
  if (writer.isSavingEnabled() && writer.getDir()) scheduleTemporaryPartitionCleanup();

  const { api: baseApi } = createCommonLogger({
    levels,
    minLevel: cfg.minLevel,
    defaultSource: cfg.source,
    serializers: cfg.serializers,
    redact: cfg.redact,
    sample: cfg.sample,
    getPartition: () => activePartition,
    writeEntry(entry, levelConfig) {
      if (consoleOptions.enabled && (bypassConsoleVisibility || !consoleVisibility.shouldHide(entry.group))) {
        writeConsole(levelConfig.stream, formatConsole(entry, levelConfig, consoleOptions, timeZone));
      }
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
      const previousDir = writer.getDir();
      unregisterTemporaryPartition();
      writer.setDir(safeResolveDir(nextDir));
      if (activePartition && activeTemporary && writer.isSavingEnabled() && writer.getDir()) {
        touchPartitionMarkerSync(writer.getDir(), activePartition, { temporary: true });
      }
      registerTemporaryPartition();
      if (previousDir && previousDir !== writer.getDir()) scheduleTemporaryPartitionCleanup(previousDir);
      if (writer.isSavingEnabled() && writer.getDir()) scheduleTemporaryPartitionCleanup();
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
      await applyActivePartition(nextPartition, nextTemporary);
    },
    async finalizePartition(partition, options) {
      return finalizeActivePartition(partition, options, "merge");
    },
    async promotePartition(partition, options) {
      return finalizeActivePartition(partition, options, "error");
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
      if (!partition) throw createPartitionError("partition-not-set");
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
    async close() {
      const cleanupDir = writer.getDir();
      unregisterTemporaryPartition();
      await writer.close();
      await cleanupTemporaryPartitions(cleanupDir);
    },
  });

  api.requestLogger = buildRequestMiddleware(api, cfg.request);

  if (cfg.quiet !== true && !packageGreetingShown) {
    packageGreetingShown = true;
    withConsoleVisibilityBypass(() => {
      api.success("logger.initialize", "@trebired/logger initialized");
      if (!storageBackendNoticeShown) {
        storageBackendNoticeShown = true;
        api.info("logger.initialize", activeStorageBackendNotice());
      }
    });
  }

  return api;
}

export { createLog, resetCreateLogStateForTests };
