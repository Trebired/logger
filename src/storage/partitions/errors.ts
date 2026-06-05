type PartitionErrorCode =
  | "missing-log-dir"
  | "partition-already-exists"
  | "partition-merge-target-same-as-source"
  | "partition-not-set";

type PartitionError = Error & {
  code: PartitionErrorCode;
  partition?: string;
  from?: string;
  to?: string;
};

function createPartitionError(
  code: PartitionErrorCode,
  details: {
    partition?: string;
    from?: string;
    to?: string;
  } = {},
): PartitionError {
  let message: string = code;

  if (code === "partition-already-exists" && details.partition) {
    message = `${code}: ${details.partition}`;
  } else if (code === "partition-merge-target-same-as-source" && details.partition) {
    message = `${code}: ${details.partition}`;
  }

  const error = new Error(message) as PartitionError;
  error.code = code;
  if (details.partition) error.partition = details.partition;
  if (details.from) error.from = details.from;
  if (details.to) error.to = details.to;
  return error;
}

function getPartitionErrorCode(error: unknown): PartitionErrorCode | null {
  if (error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string") {
    const code = (error as { code: string }).code;
    if (
      code === "missing-log-dir"
      || code === "partition-already-exists"
      || code === "partition-merge-target-same-as-source"
      || code === "partition-not-set"
    ) {
      return code;
    }
  }

  const message = error instanceof Error ? error.message : String(error || "");
  if (!message) return null;

  for (const code of [
    "missing-log-dir",
    "partition-already-exists",
    "partition-merge-target-same-as-source",
    "partition-not-set",
  ] as const) {
    if (message === code || message.startsWith(`${code}:`)) {
      return code;
    }
  }

  return null;
}

function isPartitionError(error: unknown, code?: PartitionErrorCode): boolean {
  const resolved = getPartitionErrorCode(error);
  if (!resolved) return false;
  return code ? resolved === code : true;
}

export { createPartitionError, getPartitionErrorCode, isPartitionError };
export type { PartitionError, PartitionErrorCode };
