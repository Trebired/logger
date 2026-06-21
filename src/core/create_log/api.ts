import { buildRequestMiddleware } from "#8y9zkb2bigg2";
import { activeStorageBackendNotice } from "#1qrb8ldbr5aj";
import {
  exportPartition as exportStoredPartition,
  exportPartitions as exportStoredPartitions,
} from "#uobjnphrxi2c";
import { sanitizePartitionName } from "#x2qkmwodgsce";
import {
  getPartitionInfo as getStoredPartitionInfo,
  listPartitions as listStoredPartitions,
} from "#76iooq23kphm";
import { getLogsForDir } from "#zgjmhffod2k1";
import type { LogInstance } from "#tvzweoxg5ahk";
import { finalizeActivePartition } from "./finalize.js";
import type {
  CreateLogRuntime,
  CreateLogSharedState,
} from "./runtime.js";

function createFinalizeDependencies(runtime: CreateLogRuntime) {
  return {
    cleanupTemporaryPartitions: () => runtime.cleanupTemporaryPartitions(),
    getDir: () => runtime.writer.getDir(),
    getPartition: () => runtime.state.activePartition,
    isSavingEnabled: () => runtime.writer.isSavingEnabled(),
    isTemporary: () => runtime.state.activeTemporary,
    setTemporary: (value: boolean) => {
      runtime.state.activeTemporary = value;
    },
    unregisterTemporaryPartition: () => runtime.unregisterTemporaryPartition(),
    applyActivePartition: (partition: string | null, temporary: boolean) =>
      runtime.applyActivePartition(partition, temporary),
    flush: () => runtime.writer.flush(),
  };
}

function createDirectoryApi(runtime: CreateLogRuntime) {
  return {
    getDir() {
      return runtime.writer.getDir();
    },
    setDir(nextDir: string) {
      const previousDir = runtime.writer.getDir();
      runtime.unregisterTemporaryPartition();
      runtime.writer.setDir(runtime.safeResolveDir(nextDir));
      runtime.syncTemporaryPartitionMarker();
      runtime.registerTemporaryPartition();

      if (previousDir && previousDir !== runtime.writer.getDir()) {
        runtime.scheduleTemporaryPartitionCleanup(previousDir);
      }

      if (runtime.writer.isSavingEnabled() && runtime.writer.getDir()) {
        runtime.scheduleTemporaryPartitionCleanup();
      }
    },
  };
}

function resolveNextTemporaryFlag(runtime: CreateLogRuntime, nextPartition: string | null, options: unknown): boolean {
  const hasTemporary = Object.prototype.hasOwnProperty.call(options || {}, "temporary");
  const samePartition = nextPartition === runtime.state.activePartition;

  if (!nextPartition) {
    return false;
  }

  if (hasTemporary) {
    return (options as { temporary?: boolean }).temporary === true;
  }

  return samePartition ? runtime.state.activeTemporary : false;
}

function createPartitionApi(runtime: CreateLogRuntime) {
  return {
    getPartition() {
      return runtime.state.activePartition;
    },
    async setPartition(partition, options) {
      const nextPartition = partition == null ? null : sanitizePartitionName(String(partition));
      const nextTemporary = resolveNextTemporaryFlag(runtime, nextPartition, options);

      await runtime.writer.flush();
      await runtime.applyActivePartition(nextPartition, nextTemporary);
    },
    async finalizePartition(partition, options) {
      return finalizeActivePartition(createFinalizeDependencies(runtime), partition, options, "merge");
    },
    async promotePartition(partition, options) {
      return finalizeActivePartition(createFinalizeDependencies(runtime), partition, options, "error");
    },
    async listPartitions() {
      return listStoredPartitions(runtime.writer.getDir());
    },
  };
}

function resolveExportPartitionArgs(
  activePartition: string | null,
  partitionOrOptions: unknown,
  maybeOptions: unknown,
) {
  const hasPartitionArg = typeof partitionOrOptions === "string";
  const partition = hasPartitionArg
    ? sanitizePartitionName(partitionOrOptions)
    : activePartition;
  const options =
    (hasPartitionArg
      ? maybeOptions
      : partitionOrOptions && typeof partitionOrOptions === "object"
        ? partitionOrOptions
        : maybeOptions) || {};

  return {
    partition,
    options,
  };
}

function createExportApi(runtime: CreateLogRuntime) {
  return {
    async exportPartition(partitionOrOptions, maybeOptions) {
      await runtime.writer.flush();
      const resolved = resolveExportPartitionArgs(
        runtime.state.activePartition,
        partitionOrOptions,
        maybeOptions,
      );

      if (!resolved.partition) {
        throw new Error("partition-not-set");
      }

      return exportStoredPartition(
        runtime.writer.getDir(),
        resolved.partition,
        resolved.options as never,
      );
    },
    async exportPartitions(options) {
      await runtime.writer.flush();
      return exportStoredPartitions(runtime.writer.getDir(), options || {});
    },
  };
}

function buildLogsQuery(
  runtime: CreateLogRuntime,
  options: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const query: Record<string, unknown> = {
    ...(options || {}),
    levels: runtime.levels,
  };

  if (Object.prototype.hasOwnProperty.call(options || {}, "partition")) {
    query.partition = options?.partition ?? null;
  } else if (runtime.state.activePartition) {
    query.partition = runtime.state.activePartition;
  }

  return query;
}

function createQueryApi(runtime: CreateLogRuntime) {
  return {
    async getPartitionInfo(partition) {
      const target = partition == null
        ? runtime.state.activePartition
        : sanitizePartitionName(partition);

      if (!target) {
        return null;
      }

      return getStoredPartitionInfo(runtime.writer.getDir(), target);
    },
    async getAllLogs(options) {
      await runtime.writer.flush();
      return getLogsForDir(runtime.writer.getDir(), buildLogsQuery(runtime, options));
    },
    async getAllLogsAcrossPartitions(options) {
      await runtime.writer.flush();
      return getLogsForDir(runtime.writer.getDir(), {
        ...(options || {}),
        acrossPartitions: true,
        levels: runtime.levels,
      });
    },
  };
}

function createCloseApi(runtime: CreateLogRuntime) {
  return {
    async close() {
      const cleanupDir = runtime.writer.getDir();
      runtime.unregisterTemporaryPartition();
      await runtime.writer.close();
      await runtime.cleanupTemporaryPartitions(cleanupDir);
    },
  };
}

function createExtendedLogApi(runtime: CreateLogRuntime) {
  return {
    ...createDirectoryApi(runtime),
    ...createPartitionApi(runtime),
    ...createExportApi(runtime),
    ...createQueryApi(runtime),
    ...createCloseApi(runtime),
  };
}

function attachLogApi(api: LogInstance, runtime: CreateLogRuntime): void {
  Object.assign(api, createExtendedLogApi(runtime));
  api.requestLogger = buildRequestMiddleware(api, runtime.cfg.request);
}

function maybeShowInitializationNotices(
  api: LogInstance,
  runtime: CreateLogRuntime,
  sharedState: CreateLogSharedState,
): void {
  if (runtime.cfg.quiet === true || sharedState.packageGreetingShown) {
    return;
  }

  sharedState.packageGreetingShown = true;
  runtime.withConsoleVisibilityBypass(() => {
    api.success("logger.initialize", "@trebired/logger initialized");

    if (!sharedState.storageBackendNoticeShown) {
      sharedState.storageBackendNoticeShown = true;
      api.info("logger.initialize", activeStorageBackendNotice());
    }
  });
}

export {
  attachLogApi,
  maybeShowInitializationNotices,
};
