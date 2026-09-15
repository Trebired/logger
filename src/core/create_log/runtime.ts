import path from "node:path";

import { createCommonLogger } from "#ubetf5s0pfc2";
import { formatConsole, writeConsole } from "#va6txcqwm0gh";
import { normalizeConsoleOptions } from "#b2k4pfb67duj";
import { normalizeLevels } from "#g4tupkl7rvk4";
import { logStream } from "#iaj6xqns4o0s";
import type { CreateLogOptions, LogInstance } from "#e1h3ay0cyhgl";
import { normalizeTimeZone } from "#0c4ri7nq63zi";
import { toTrimmedString as toString } from "@trebired/utils";
import {
  loadCachedConfigSync,
  mergeCreateLogOptions,
} from "#oupu3ud6munp";
import { resolveCallerConfigStart } from "#s0mrne0yjht8";
import { normalizePartitionKey } from "#nm6ripurqb56";
import { normalizeRetentionOptions, normalizeWriteOptions } from "#41i2nrddbcth";
import { createRetentionScheduler, type RetentionScheduler } from "#kear2obg46d3";
import { StoreWriter } from "#mdfld2li9at9";
import { keepTemporaryPartitions } from "./partition_state.js";

type TemporaryPartitionRegistration = {
  dir: string;
  partition: string;
};

type CreateLogRuntimeState = {
  activePartition: string | null;
  activeTemporary: boolean;
  registeredTemporaryPartition: TemporaryPartitionRegistration | null;
};

type CreateLogSharedState = {
  activeTemporaryPartitionsByDir: Map<string, Set<string>>;
  packageGreetingShown: boolean;
};

type CreateLogRuntime = {
  cfg: CreateLogOptions;
  writer: StoreWriter;
  retention: RetentionScheduler;
  state: CreateLogRuntimeState;
  sharedState: CreateLogSharedState;
  levels: ReturnType<typeof normalizeLevels>;
  consoleOptions: ReturnType<typeof normalizeConsoleOptions>;
  timeZone: string;
};

function safeResolveDir(value: unknown): string {
  const raw = toString(value);
  return raw ? path.resolve(raw) : "";
}

function resolveRuntimeConfig(options: CreateLogOptions): CreateLogOptions {
  const input = options && typeof options === "object" ? options : {};
  const loggerConfig = loadCachedConfigSync(resolveCallerConfigStart());
  const prefix = Object.prototype.hasOwnProperty.call(input, "prefix") ? input.prefix : loggerConfig.prefix;
  return {
    ...mergeCreateLogOptions(loggerConfig.defaults, input),
    prefix,
  };
}

function createStoreWriter(cfg: CreateLogOptions): StoreWriter {
  return new StoreWriter({
      dir: safeResolveDir(cfg.dir),
      save: typeof cfg.save === "boolean" ? cfg.save : Boolean(toString(cfg.dir)),
      write: normalizeWriteOptions(cfg.write),
      onError: (message) => writeConsole("stderr", message),
  });
}

function createCreateLogRuntime(
  options: CreateLogOptions = {},
  sharedState: CreateLogSharedState,
): CreateLogRuntime {
  const cfg = resolveRuntimeConfig(options);
  const writer = createStoreWriter(cfg);
  const retention = createRetentionScheduler({
      getStore: () => writer.getStore(),
      options: normalizeRetentionOptions(cfg.retention),
      keepTemporary: () => keepTemporaryPartitions(sharedState, writer.getDir()),
      onError: (message) => writeConsole("stderr", message),
  });

  return {
    cfg,
    writer,
    retention,
    sharedState,
    state: {
      activePartition: normalizePartitionKey(cfg.partition) || null,
      activeTemporary: cfg.temporaryPartition === true && Boolean(normalizePartitionKey(cfg.partition)),
      registeredTemporaryPartition: null,
    },
    levels: normalizeLevels(cfg.levels),
    consoleOptions: normalizeConsoleOptions(cfg.console),
    timeZone: normalizeTimeZone(cfg.timeZone),
  };
}

function createBaseLogApi(runtime: CreateLogRuntime): LogInstance {
  const { api } = createCommonLogger({
      levels: runtime.levels,
      minLevel: runtime.cfg.minLevel,
      groupPrefix: runtime.cfg.prefix,
      defaultSource: runtime.cfg.source,
      serializers: runtime.cfg.serializers,
      redact: runtime.cfg.redact,
      sample: runtime.cfg.sample,
      getPartition: () => runtime.state.activePartition,
      writeEntry(entry, levelConfig) {
        if (runtime.consoleOptions.enabled) {
          writeConsole(
            levelConfig.stream,
            formatConsole(entry, levelConfig, runtime.consoleOptions, runtime.timeZone),
          );
        }

        runtime.writer.write(entry, runtime.state.activeTemporary);

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

export { createBaseLogApi, createCreateLogRuntime, safeResolveDir };
export type { CreateLogRuntime, CreateLogSharedState };
