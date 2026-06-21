import path from "node:path";

import { resolveConsoleVisibilityPolicy } from "#jp65xdmizety";
import { createCommonLogger } from "#ubetf5s0pfc2";
import { formatConsole, writeConsole } from "#va6txcqwm0gh";
import { normalizeConsoleOptions } from "#b2k4pfb67duj";
import { normalizeLevels } from "#g4tupkl7rvk4";
import { logStream } from "#iaj6xqns4o0s";
import { normalizePartitionKey } from "#x2qkmwodgsce";
import { deleteNonCurrentTemporaryPartitions } from "#qqlp8cyr3105";
import { touchPartitionMarkerSync } from "#76iooq23kphm";
import { normalizeRetentionOptions, normalizeWriteOptions } from "#pngx4lcsdjmx";
import { FileWriter } from "#w1cc3mztq3ng";
import type { CreateLogOptions, LogInstance } from "#tvzweoxg5ahk";
import { normalizeTimeZone } from "#0c4ri7nq63zi";
import { maybeShowNodeRuntimeNotice, writePackageNotice } from "#nmfh3v2le5vp";
import { toString } from "#ycytzc4gr3f7";

type TemporaryPartitionRegistration = {
  dir: string;
  partition: string;
};

type CreateLogRuntimeState = {
  activePartition: string | null;
  activeTemporary: boolean;
  bypassConsoleVisibility: boolean;
  registeredTemporaryPartition: TemporaryPartitionRegistration | null;
};

type CreateLogRuntime = {
  cfg: CreateLogOptions;
  writer: FileWriter;
  state: CreateLogRuntimeState;
  levels: ReturnType<typeof normalizeLevels>;
  consoleOptions: ReturnType<typeof normalizeConsoleOptions>;
  consoleVisibility: ReturnType<typeof resolveConsoleVisibilityPolicy>;
  timeZone: string;
  withConsoleVisibilityBypass: <T>(fn: () => T) => T;
  registerTemporaryPartition: () => void;
  unregisterTemporaryPartition: () => void;
  cleanupTemporaryPartitions: (dir?: string) => Promise<void>;
  scheduleTemporaryPartitionCleanup: (dir?: string) => void;
  applyActivePartition: (partition: string | null, temporary: boolean) => Promise<void>;
  syncTemporaryPartitionMarker: () => void;
  initializeTemporaryPartitionState: () => void;
  safeResolveDir: (value: unknown) => string;
};

type CreateLogSharedState = {
  activeTemporaryPartitionsByDir: Map<string, Set<string>>;
  packageGreetingShown: boolean;
  storageBackendNoticeShown: boolean;
};

function safeResolveDir(value: unknown): string {
  const raw = toString(value);
  return raw ? path.resolve(raw) : "";
}

function cleanupErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createRuntimeState(cfg: CreateLogOptions): CreateLogRuntimeState {
  return {
    activePartition: normalizePartitionKey(cfg.partition) || null,
    activeTemporary: cfg.temporaryPartition === true,
    bypassConsoleVisibility: false,
    registeredTemporaryPartition: null,
  };
}

function createFileWriter(cfg: CreateLogOptions, timeZone: string): FileWriter {
  return new FileWriter({
    dir: safeResolveDir(cfg.dir),
    save: typeof cfg.save === "boolean" ? cfg.save : Boolean(toString(cfg.dir)),
    write: normalizeWriteOptions(cfg.write),
    retention: normalizeRetentionOptions(cfg.retention),
    timeZone,
    onError: (message) => writeConsole("stderr", message),
  });
}

function createTemporaryPartitionCleaner(sharedState: CreateLogSharedState) {
  return function keepTemporaryPartitions(dir: string): string[] {
    return Array.from(sharedState.activeTemporaryPartitionsByDir.get(dir) || []);
  };
}

function unregisterTemporaryPartition(
  runtime: Pick<CreateLogRuntime, "state">,
  sharedState: CreateLogSharedState,
): void {
  const registered = runtime.state.registeredTemporaryPartition;
  if (!registered) {
    return;
  }

  const current = sharedState.activeTemporaryPartitionsByDir.get(registered.dir);
  if (current) {
    current.delete(registered.partition);
    if (current.size === 0) {
      sharedState.activeTemporaryPartitionsByDir.delete(registered.dir);
    }
  }

  runtime.state.registeredTemporaryPartition = null;
}

function registerTemporaryPartition(
  runtime: Pick<CreateLogRuntime, "state" | "writer">,
  sharedState: CreateLogSharedState,
): void {
  unregisterTemporaryPartition(runtime, sharedState);

  if (!runtime.state.activeTemporary || !runtime.state.activePartition) {
    return;
  }

  if (!runtime.writer.isSavingEnabled() || !runtime.writer.getDir()) {
    return;
  }

  const dir = runtime.writer.getDir();
  const current = sharedState.activeTemporaryPartitionsByDir.get(dir) || new Set<string>();
  current.add(runtime.state.activePartition);
  sharedState.activeTemporaryPartitionsByDir.set(dir, current);
  runtime.state.registeredTemporaryPartition = {
    dir,
    partition: runtime.state.activePartition,
  };
}

async function cleanupTemporaryPartitions(
  runtime: Pick<CreateLogRuntime, "writer">,
  sharedState: CreateLogSharedState,
  dir = runtime.writer.getDir(),
): Promise<void> {
  if (!runtime.writer.isSavingEnabled() || !dir) {
    return;
  }

  const keepTemporaryPartitions = createTemporaryPartitionCleaner(sharedState);
  await deleteNonCurrentTemporaryPartitions(dir, keepTemporaryPartitions(dir));
}

function scheduleTemporaryPartitionCleanup(
  runtime: Pick<CreateLogRuntime, "writer">,
  sharedState: CreateLogSharedState,
  dir = runtime.writer.getDir(),
): void {
  if (!runtime.writer.isSavingEnabled() || !dir) {
    return;
  }

  void cleanupTemporaryPartitions(runtime, sharedState, dir).catch((error) => {
    writeConsole(
      "stderr",
      `[trebired.logger] temporary partition cleanup failed: ${cleanupErrorMessage(error)}`,
    );
  });
}

function createApplyActivePartition(runtime: Pick<CreateLogRuntime, "state" | "writer">, actions: {
  unregisterTemporaryPartition: () => void;
  registerTemporaryPartition: () => void;
  cleanupTemporaryPartitions: () => Promise<void>;
}) {
  return async function applyActivePartition(
    nextPartition: string | null,
    nextTemporary: boolean,
  ): Promise<void> {
    actions.unregisterTemporaryPartition();
    runtime.state.activePartition = nextPartition;
    runtime.state.activeTemporary = nextTemporary;

    if (runtime.state.activePartition && runtime.writer.isSavingEnabled() && runtime.writer.getDir()) {
      touchPartitionMarkerSync(runtime.writer.getDir(), runtime.state.activePartition, {
        temporary: runtime.state.activeTemporary,
      });
    }

    actions.registerTemporaryPartition();
    await actions.cleanupTemporaryPartitions();
  };
}

function withConsoleVisibilityBypass<T>(runtime: Pick<CreateLogRuntime, "state">, fn: () => T): T {
  runtime.state.bypassConsoleVisibility = true;
  try {
    return fn();
  } finally {
    runtime.state.bypassConsoleVisibility = false;
  }
}

function createTemporaryRuntime(
  cfg: CreateLogOptions,
) {
  const writer = createFileWriter(cfg, normalizeTimeZone(cfg.timeZone));
  const state = createRuntimeState(cfg);
  const tempRuntime = { state, writer };

  return {
    state,
    writer,
    tempRuntime,
  };
}

function writeConsoleVisibilityWarning(
  consoleVisibility: ReturnType<typeof resolveConsoleVisibilityPolicy>,
): void {
  if (consoleVisibility.warning) {
    writePackageNotice(consoleVisibility.warning);
  }
}

function createCreateLogRuntime(
  options: CreateLogOptions = {},
  sharedState: CreateLogSharedState,
): CreateLogRuntime {
  const cfg = options && typeof options === "object" ? options : {};
  maybeShowNodeRuntimeNotice(cfg.quiet);
  const levels = normalizeLevels(cfg.levels);
  const consoleOptions = normalizeConsoleOptions(cfg.console);
  const consoleVisibility = resolveConsoleVisibilityPolicy();
  const timeZone = normalizeTimeZone(cfg.timeZone);
  const { state, writer, tempRuntime } = createTemporaryRuntime(cfg);
  const applyActivePartition = createApplyActivePartition(tempRuntime, {
    unregisterTemporaryPartition: () => unregisterTemporaryPartition(tempRuntime, sharedState),
    registerTemporaryPartition: () => registerTemporaryPartition(tempRuntime, sharedState),
    cleanupTemporaryPartitions: () => cleanupTemporaryPartitions(tempRuntime, sharedState),
  });
  writeConsoleVisibilityWarning(consoleVisibility);

  return {
    cfg,
    writer,
    state,
    levels,
    consoleOptions,
    consoleVisibility,
    timeZone,
    safeResolveDir,
    withConsoleVisibilityBypass: (fn) => withConsoleVisibilityBypass({ state }, fn),
    applyActivePartition,
    syncTemporaryPartitionMarker() {
      if (state.activePartition && state.activeTemporary && writer.isSavingEnabled() && writer.getDir()) {
        touchPartitionMarkerSync(writer.getDir(), state.activePartition, {
          temporary: true,
        });
      }
    },
    initializeTemporaryPartitionState() {
      this.syncTemporaryPartitionMarker();
      registerTemporaryPartition(tempRuntime, sharedState);
      if (writer.isSavingEnabled() && writer.getDir()) {
        scheduleTemporaryPartitionCleanup(tempRuntime, sharedState);
      }
    },
    unregisterTemporaryPartition: () => unregisterTemporaryPartition(tempRuntime, sharedState),
    registerTemporaryPartition: () => registerTemporaryPartition(tempRuntime, sharedState),
    cleanupTemporaryPartitions: (dir) => cleanupTemporaryPartitions(tempRuntime, sharedState, dir),
    scheduleTemporaryPartitionCleanup: (dir) =>
      scheduleTemporaryPartitionCleanup(tempRuntime, sharedState, dir),
  };
}

function createBaseLogApi(runtime: CreateLogRuntime): LogInstance {
  const { api } = createCommonLogger({
    levels: runtime.levels,
    minLevel: runtime.cfg.minLevel,
    defaultSource: runtime.cfg.source,
    serializers: runtime.cfg.serializers,
    redact: runtime.cfg.redact,
    sample: runtime.cfg.sample,
    getPartition: () => runtime.state.activePartition,
    writeEntry(entry, levelConfig) {
      if (
        runtime.consoleOptions.enabled &&
        (runtime.state.bypassConsoleVisibility ||
          !runtime.consoleVisibility.shouldHide(entry.group))
      ) {
        writeConsole(
          levelConfig.stream,
          formatConsole(entry, levelConfig, runtime.consoleOptions, runtime.timeZone),
        );
      }

      runtime.writer.write(entry);

      try {
        logStream.emit("log", entry, {
          runtime: "server",
          dir: runtime.writer.getDir(),
        });
      } catch {}
    },
    flush() {
      return runtime.writer.flush();
    },
    close() {
      return runtime.writer.close();
    },
    getStats() {
      return runtime.writer.getStats();
    },
  });

  return api as LogInstance;
}

export { createBaseLogApi, createCreateLogRuntime };
export type { CreateLogSharedState };
export type { CreateLogRuntime };
