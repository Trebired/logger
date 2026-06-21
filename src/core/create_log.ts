import type { CreateLogOptions, LogInstance } from "#tvzweoxg5ahk";
import {
  createBaseLogApi,
  createCreateLogRuntime,
  type CreateLogSharedState,
} from "./create_log/runtime.js";
import {
  attachLogApi,
  maybeShowInitializationNotices,
} from "./create_log/api.js";

const sharedState: CreateLogSharedState = {
  packageGreetingShown: false,
  storageBackendNoticeShown: false,
  activeTemporaryPartitionsByDir: new Map<string, Set<string>>(),
};

function resetCreateLogStateForTests(): void {
  sharedState.packageGreetingShown = false;
  sharedState.storageBackendNoticeShown = false;
  sharedState.activeTemporaryPartitionsByDir.clear();
}

function createLog(options: CreateLogOptions = {}): LogInstance {
  const runtime = createCreateLogRuntime(options, sharedState);
  runtime.initializeTemporaryPartitionState();

  const api = createBaseLogApi(runtime);
  attachLogApi(api, runtime);
  maybeShowInitializationNotices(api, runtime, sharedState);

  return api;
}

export { createLog, resetCreateLogStateForTests };
