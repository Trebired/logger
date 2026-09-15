import { writeConsole } from "#va6txcqwm0gh";
import { setPartitionTemporary } from "#keuo3g4mir79";
import type { CreateLogRuntime, CreateLogSharedState } from "./runtime.js";

type PartitionStateRuntime = Pick<CreateLogRuntime, "sharedState"|"state"|"writer">;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unregisterTemporaryPartition(runtime: PartitionStateRuntime): void {
  const registered = runtime.state.registeredTemporaryPartition;
  if (!registered) return;

  const current = runtime.sharedState.activeTemporaryPartitionsByDir.get(registered.dir);
  if (current) {
    current.delete(registered.partition);
    if (current.size === 0) runtime.sharedState.activeTemporaryPartitionsByDir.delete(registered.dir);
  }
  runtime.state.registeredTemporaryPartition = null;
}

function registerTemporaryPartition(runtime: PartitionStateRuntime): void {
  unregisterTemporaryPartition(runtime);
  const dir = runtime.writer.getDir();
  const partition = runtime.state.activePartition;
  if (!runtime.state.activeTemporary || !partition || !runtime.writer.isSavingEnabled()) return;

  const current = runtime.sharedState.activeTemporaryPartitionsByDir.get(dir) || new Set<string>();
  current.add(partition);
  runtime.sharedState.activeTemporaryPartitionsByDir.set(dir, current);
  runtime.state.registeredTemporaryPartition = { dir, partition };
}

function syncActivePartitionRow(runtime: PartitionStateRuntime): void {
  const partition = runtime.state.activePartition;
  if (!partition) return;
  try {
    const store = runtime.writer.getStore();
    if (store) setPartitionTemporary(store, partition, runtime.state.activeTemporary);
  } catch (error) {
    writeConsole("stderr", `log partition sync failed: ${errorMessage(error)}`);
  }
}

function syncPartitionState(runtime: PartitionStateRuntime): void {
  syncActivePartitionRow(runtime);
  registerTemporaryPartition(runtime);
}

async function applyActivePartition(
  runtime: PartitionStateRuntime,
  partition: string | null,
  temporary: boolean,
): Promise<void> {
  await runtime.writer.flush();
  unregisterTemporaryPartition(runtime);
  runtime.state.activePartition = partition;
  runtime.state.activeTemporary = partition ? temporary : false;
  syncPartitionState(runtime);
}

function keepTemporaryPartitions(sharedState: CreateLogSharedState, dir: string): string[] {
  return Array.from(sharedState.activeTemporaryPartitionsByDir.get(dir) || []);
}

export {
  applyActivePartition,
  keepTemporaryPartitions,
  syncPartitionState,
  unregisterTemporaryPartition,
};
