import type { CreateLogOptions, LogInstance } from "#e1h3ay0cyhgl";
import {
  createBaseLogApi,
  createCreateLogRuntime,
  type CreateLogSharedState,
} from "./create_log/runtime.js";
import {
  attachLogApi,
  maybeShowInitializationNotices,
} from "./create_log/api.js";
import { syncPartitionState } from "./create_log/partition_state.js";

const sharedState: CreateLogSharedState = {
  packageGreetingShown: false,
  activeTemporaryPartitionsByDir: new Map<string, Set<string>>(),
};

function resetCreateLogStateForTests(): void {
  sharedState.packageGreetingShown = false;
  sharedState.activeTemporaryPartitionsByDir.clear();
}

function createLog(options: CreateLogOptions = {}): LogInstance {
  const runtime = createCreateLogRuntime(options, sharedState);
  syncPartitionState(runtime);
  runtime.retention.start();

  const api = createBaseLogApi(runtime);
  attachLogApi(api, runtime);
  maybeShowInitializationNotices(api, runtime, sharedState);

  return api;
}

export { createLog, resetCreateLogStateForTests };
