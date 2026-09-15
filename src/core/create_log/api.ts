import { buildRequestMiddleware } from "#8y9zkb2bigg2";
import type {
  ExportLogsOptions,
  ListGroupsOptions,
  LogInstance,
  LogQueryOptions,
  SetPartitionOptions,
  SnapshotStoreOptions,
} from "#e1h3ay0cyhgl";
import { sanitizePartitionName } from "#nm6ripurqb56";
import {
  exportLogs,
  getPartitionInfo,
  listGroups,
  listPartitions,
  queryLogs,
  snapshotStore,
} from "#5k5op6svi3eq";
import { finalizeActivePartition } from "./finalize.js";
import {
  applyActivePartition,
  syncPartitionState,
  unregisterTemporaryPartition,
} from "./partition_state.js";
import { safeResolveDir, type CreateLogRuntime, type CreateLogSharedState } from "./runtime.js";
import {
  buildPackageLogGroup,
  PACKAGE_NAME,
} from "#qz1iteme01ng";

const LOGGER_LOG_GROUP = buildPackageLogGroup();

function withActivePartition<T extends{partition?:string|null}>(runtime: CreateLogRuntime, options: T | undefined): T {
  const input = (options || {}) as T;
  if (Object.prototype.hasOwnProperty.call(input, "partition")) return input;
  return { ...input, partition: runtime.state.activePartition };
}

function resolveNextTemporaryFlag(runtime: CreateLogRuntime, nextPartition: string | null, options?: SetPartitionOptions): boolean {
  if (!nextPartition) return false;
  if (Object.prototype.hasOwnProperty.call(options || {}, "temporary")) return options?.temporary === true;
  return nextPartition === runtime.state.activePartition ? runtime.state.activeTemporary : false;
}

function createPartitionApi(runtime: CreateLogRuntime) {
  return {
    getDir: () => runtime.writer.getDir(),
    setDir(nextDir: string) {
      unregisterTemporaryPartition(runtime);
      runtime.writer.setDir(safeResolveDir(nextDir));
      syncPartitionState(runtime);
      runtime.retention.start();
    },
    getPartition: () => runtime.state.activePartition,
    async setPartition(partition: string | null, options?: SetPartitionOptions) {
      const nextPartition = partition == null ? null : sanitizePartitionName(String(partition));
      await applyActivePartition(runtime, nextPartition, resolveNextTemporaryFlag(runtime, nextPartition, options));
    },
    finalizePartition: (partition: string, options?: { ifExists?: "error" | "merge" | "replace" }) =>
    finalizeActivePartition(runtime, partition, options),
    async getPartitionInfo(partition?: string) {
      const target = partition == null ? runtime.state.activePartition : sanitizePartitionName(partition);
      if (!target || !runtime.writer.getDir()) return null;
      await runtime.writer.flush();
      return getPartitionInfo(runtime.writer.getDir(), target);
    },
    async listPartitions() {
      await runtime.writer.flush();
      return listPartitions(runtime.writer.getDir());
    },
  };
}

function createReadApi(runtime: CreateLogRuntime) {
  return {
    async queryLogs(options?: LogQueryOptions) {
      await runtime.writer.flush();
      return queryLogs(runtime.writer.getDir(), { levels: runtime.levels, ...withActivePartition(runtime, options) });
    },
    async listGroups(options?: ListGroupsOptions) {
      await runtime.writer.flush();
      return listGroups(runtime.writer.getDir(), withActivePartition(runtime, options));
    },
    async exportLogs(options: ExportLogsOptions) {
      await runtime.writer.flush();
      return exportLogs(runtime.writer.getDir(), { levels: runtime.levels, ...withActivePartition(runtime, options) });
    },
    async snapshotStore(options: SnapshotStoreOptions) {
      await runtime.writer.flush();
      return snapshotStore(runtime.writer.getDir(), options);
    },
    async runRetention() {
      await runtime.writer.flush();
      return runtime.retention.runNow();
    },
    async close() {
      unregisterTemporaryPartition(runtime);
      runtime.retention.stop();
      await runtime.writer.close();
    },
  };
}

function attachLogApi(api: LogInstance, runtime: CreateLogRuntime): void {
  Object.assign(api, createPartitionApi(runtime), createReadApi(runtime));
  api.requestLogger = buildRequestMiddleware(api, runtime.cfg.request);
}

function maybeShowInitializationNotices(
  api: LogInstance,
  runtime: CreateLogRuntime,
  sharedState: CreateLogSharedState,
): void {
  if (runtime.cfg.quiet === true || sharedState.packageGreetingShown) return;
  sharedState.packageGreetingShown = true;
  api.success(`${LOGGER_LOG_GROUP}.initialize`, `${PACKAGE_NAME} initialized`);
}

export {
  attachLogApi,
  maybeShowInitializationNotices,
};
