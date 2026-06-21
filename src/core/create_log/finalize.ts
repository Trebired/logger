import type {
  FinalizePartitionAction,
  FinalizePartitionOptions,
  FinalizePartitionResult,
  PartitionExistsPolicy,
  PromotePartitionOptions,
} from "#tvzweoxg5ahk";
import { createPartitionError, isPartitionError } from "#h0uexrz2k072";
import {
  getPartitionInfo as getStoredPartitionInfo,
  mergePartition,
  renamePartition,
  touchPartitionMarkerSync,
} from "#76iooq23kphm";
import { sanitizePartitionName } from "#x2qkmwodgsce";

type FinalizePartitionDependencies = {
  cleanupTemporaryPartitions: () => Promise<void>;
  getDir: () => string;
  getPartition: () => string | null;
  isSavingEnabled: () => boolean;
  isTemporary: () => boolean;
  setTemporary: (value: boolean) => void;
  unregisterTemporaryPartition: () => void;
  applyActivePartition: (partition: string | null, temporary: boolean) => Promise<void>;
  flush: () => Promise<void>;
};

function resolvePartitionExistsPolicy(
  options: FinalizePartitionOptions | PromotePartitionOptions | undefined,
  fallback: PartitionExistsPolicy,
): PartitionExistsPolicy {
  if (options && typeof options === "object" && options.ifExists) {
    return options.ifExists;
  }

  if (options && typeof options === "object" && "merge" in options && options.merge === true) {
    return "merge";
  }

  return fallback;
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

async function finalizeWithoutStorage(
  deps: FinalizePartitionDependencies,
  nextPartition: string,
): Promise<FinalizePartitionResult> {
  const previousPartition = deps.getPartition();
  const temporaryBefore = deps.isTemporary();
  const activePartition = deps.getPartition();

  if (nextPartition === activePartition) {
    const action: FinalizePartitionAction = temporaryBefore ? "marked-permanent" : "already-finalized";
    deps.setTemporary(false);

    return createFinalizePartitionResult({
      action,
      partition: nextPartition,
      previousPartition,
      sourceExisted: false,
      targetExisted: false,
      temporaryBefore,
    });
  }

  await deps.applyActivePartition(nextPartition, false);

  return createFinalizePartitionResult({
    action: "activated-target",
    partition: nextPartition,
    previousPartition,
    sourceExisted: false,
    targetExisted: false,
    temporaryBefore,
  });
}

async function finalizeSamePartition(
  deps: FinalizePartitionDependencies,
  dir: string,
  partition: string,
): Promise<FinalizePartitionResult> {
  const previousPartition = deps.getPartition();
  const temporaryBefore = deps.isTemporary();

  touchPartitionMarkerSync(dir, partition, { temporary: false });
  deps.unregisterTemporaryPartition();
  deps.setTemporary(false);
  await deps.cleanupTemporaryPartitions();

  return createFinalizePartitionResult({
    action: temporaryBefore ? "marked-permanent" : "already-finalized",
    partition,
    previousPartition,
    sourceExisted: true,
    targetExisted: true,
    temporaryBefore,
  });
}

async function activateTargetPartition(args: {
  deps: FinalizePartitionDependencies;
  action: FinalizePartitionAction;
  partition: string;
  previousPartition: string | null;
  sourceExisted: boolean;
  targetExisted: boolean;
  temporaryBefore: boolean;
}): Promise<FinalizePartitionResult> {
  await args.deps.applyActivePartition(args.partition, false);

  return createFinalizePartitionResult({
    action: args.action,
    partition: args.partition,
    previousPartition: args.previousPartition,
    sourceExisted: args.sourceExisted,
    targetExisted: args.targetExisted,
    temporaryBefore: args.temporaryBefore,
  });
}

async function handleMissingSourcePartition(args: {
  deps: FinalizePartitionDependencies;
  dir: string;
  ifExists: PartitionExistsPolicy;
  nextPartition: string;
}): Promise<FinalizePartitionResult> {
  const previousPartition = args.deps.getPartition();
  const temporaryBefore = args.deps.isTemporary();
  const targetInfo = await getStoredPartitionInfo(args.dir, args.nextPartition);

  if (targetInfo) {
    if (args.ifExists === "error") {
      throw createPartitionError("partition-already-exists", {
        partition: args.nextPartition,
      });
    }

    return activateTargetPartition({
      deps: args.deps,
      action: args.ifExists === "switch" ? "switched" : "activated-target",
      partition: args.nextPartition,
      previousPartition,
      sourceExisted: false,
      targetExisted: true,
      temporaryBefore,
    });
  }

  return activateTargetPartition({
    deps: args.deps,
    action: "activated-target",
    partition: args.nextPartition,
    previousPartition,
    sourceExisted: false,
    targetExisted: false,
    temporaryBefore,
  });
}

async function handleExistingTargetPartition(args: {
  deps: FinalizePartitionDependencies;
  dir: string;
  ifExists: PartitionExistsPolicy;
  nextPartition: string;
}): Promise<FinalizePartitionResult> {
  const activePartition = args.deps.getPartition();
  const previousPartition = activePartition;
  const temporaryBefore = args.deps.isTemporary();

  if (args.ifExists === "switch") {
    return activateTargetPartition({
      deps: args.deps,
      action: "switched",
      partition: args.nextPartition,
      previousPartition,
      sourceExisted: true,
      targetExisted: true,
      temporaryBefore,
    });
  }

  if (args.ifExists === "merge" && activePartition) {
    await mergePartition(args.dir, {
      from: activePartition,
      to: args.nextPartition,
    });

    return activateTargetPartition({
      deps: args.deps,
      action: "merged",
      partition: args.nextPartition,
      previousPartition,
      sourceExisted: true,
      targetExisted: true,
      temporaryBefore,
    });
  }

  throw createPartitionError("partition-already-exists", {
    partition: args.nextPartition,
  });
}

async function finalizeStoredPartition(args: {
  deps: FinalizePartitionDependencies;
  dir: string;
  ifExists: PartitionExistsPolicy;
  nextPartition: string;
}): Promise<FinalizePartitionResult> {
  const activePartition = args.deps.getPartition();
  if (!activePartition) {
    throw createPartitionError("partition-not-set");
  }

  if (!(await getStoredPartitionInfo(args.dir, activePartition))) {
    return handleMissingSourcePartition(args);
  }

  if (await getStoredPartitionInfo(args.dir, args.nextPartition)) {
    return handleExistingTargetPartition(args);
  }

  try {
    await renamePartition(args.dir, {
      from: activePartition,
      to: args.nextPartition,
    });
  } catch (error) {
    if (!isPartitionError(error, "partition-already-exists")) {
      throw error;
    }

    return handleExistingTargetPartition(args);
  }

  return activateTargetPartition({
    deps: args.deps,
    action: "renamed",
    partition: args.nextPartition,
    previousPartition: activePartition,
    sourceExisted: true,
    targetExisted: false,
    temporaryBefore: args.deps.isTemporary(),
  });
}

async function finalizeActivePartition(
  deps: FinalizePartitionDependencies,
  partition: string,
  options: FinalizePartitionOptions | PromotePartitionOptions | undefined,
  fallbackPolicy: PartitionExistsPolicy,
): Promise<FinalizePartitionResult> {
  const activePartition = deps.getPartition();
  if (!activePartition) {
    throw createPartitionError("partition-not-set");
  }

  const nextPartition = sanitizePartitionName(partition);
  const dir = deps.getDir();
  const ifExists = resolvePartitionExistsPolicy(options, fallbackPolicy);

  await deps.flush();

  if (!deps.isSavingEnabled() || !dir) {
    return finalizeWithoutStorage(deps, nextPartition);
  }

  if (nextPartition === activePartition) {
    return finalizeSamePartition(deps, dir, nextPartition);
  }

  return finalizeStoredPartition({
    deps,
    dir,
    ifExists,
    nextPartition,
  });
}

export { finalizeActivePartition };
export type { FinalizePartitionDependencies };
