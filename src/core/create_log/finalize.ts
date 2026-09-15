import { result } from "@package/result";
import type {
  FinalizePartitionAction,
  FinalizePartitionOptions,
  FinalizePartitionResult,
} from "#e1h3ay0cyhgl";
import { createPartitionError } from "#thka022np828";
import { sanitizePartitionName } from "#nm6ripurqb56";
import { finalizeStorePartition, type FinalizeOutcome } from "#keuo3g4mir79";
import { applyActivePartition } from "./partition_state.js";
import type { CreateLogRuntime } from "./runtime.js";

function createFinalizePartitionResult(
  partition: string,
  previousPartition: string | null,
  outcome: FinalizeOutcome,
): FinalizePartitionResult {
  const data = { action: outcome.action, partition };
  return {
    partition,
    previousPartition,
    action: outcome.action,
    movedEntries: outcome.movedEntries,
    result: outcome.action === "already-final"
    ? result.noop("partition-already-finalized", { data })
    : result.ok("partition-finalized", { data }),
  };
}

function finalizeWithoutStore(runtime: CreateLogRuntime, active: string, next: string): FinalizeOutcome {
  let action: FinalizePartitionAction = "activated";
  if (active === next) action = runtime.state.activeTemporary ? "marked-permanent" : "already-final";
  return { action, movedEntries: 0 };
}

async function finalizeActivePartition(
  runtime: CreateLogRuntime,
  partition: string,
  options: FinalizePartitionOptions = {},
): Promise<FinalizePartitionResult> {
  const active = runtime.state.activePartition;
  if (!active) throw createPartitionError("partition-not-set");

  const next = sanitizePartitionName(partition);
  await runtime.writer.flush();

  const store = runtime.writer.getStore();
  const outcome = store
  ? await finalizeStorePartition(store, active, next, options.ifExists || "merge")
  : finalizeWithoutStore(runtime, active, next);

  await applyActivePartition(runtime, next, false);
  return createFinalizePartitionResult(next, active, outcome);
}

export { finalizeActivePartition };
