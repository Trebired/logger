import { result, type ResultLike } from "@package/result";

type PartitionErrorCode =
|"missing-log-dir"
|"partition-already-exists"
|"partition-not-found"
|"partition-not-set";

const PARTITION_ERROR_CODES: readonly PartitionErrorCode[] = [
  "missing-log-dir",
  "partition-already-exists",
  "partition-not-found",
  "partition-not-set",
];

type PartitionError = Error& {
  code: PartitionErrorCode;
  partition?: string;
  result?: ResultLike<null, {
    partition?: string;
  }>;
};

function createPartitionError(
  code: PartitionErrorCode,
  details: {
    partition?: string;
  } = {},
): PartitionError {
  const message = details.partition ? `${code}: ${details.partition}` : code;
  const error = new Error(message) as PartitionError;
  error.code = code;
  if (details.partition) error.partition = details.partition;
  error.result = code === "partition-already-exists"
  ? result.conflict(code, { details })
  : code === "partition-not-found"
  ? result.notFound(code, { details })
  : result.error(code, 400, { details });
  return error;
}

function getPartitionErrorCode(error: unknown): PartitionErrorCode | null {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && PARTITION_ERROR_CODES.includes(code as PartitionErrorCode)) {
      return code as PartitionErrorCode;
    }
  }

  const message = error instanceof Error ? error.message : String(error || "");
  return PARTITION_ERROR_CODES.find((code) => message === code || message.startsWith(`${code}:`)) || null;
}

function isPartitionError(error: unknown, code?: PartitionErrorCode): boolean {
  const resolved = getPartitionErrorCode(error);
  if (!resolved) return false;
  return code ? resolved === code : true;
}

export { createPartitionError, getPartitionErrorCode, isPartitionError };
export type { PartitionError, PartitionErrorCode };
