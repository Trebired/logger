import type {
  PartitionNameOptions,
  PartitionSanitizeOptions,
  PartitionSanitizer,
  PartitionTimeValue,
} from "#e1h3ay0cyhgl";
import { getLocalDateTimeParts, normalizeTimeZone } from "#0c4ri7nq63zi";
import { toTrimmedString as toString } from "@trebired/utils";

function sanitizePartitionFragment(input: string): string {
  return toString(input)
  .trim()
  .replace(/[^a-zA-Z0-9_-]+/gu, "-")
  .replace(/-+/gu, "-")
  .replace(/_+/gu, "_")
  .replace(/^[-_]+|[-_]+$/gu, "");
}

function normalizePartitionValue(input: unknown, sanitizer?: PartitionSanitizer): string {
  const raw = toString(input);
  const prepared = typeof sanitizer === "function" ? sanitizer(raw) : raw;
  const normalized = sanitizePartitionFragment(prepared);
  if (!normalized) throw new Error("invalid-partition-name");
  return normalized;
}

function sanitizePartitionName(input: string, options: PartitionSanitizeOptions = {}): string {
  return normalizePartitionValue(input, options.sanitizer);
}

function partitionTimeParts(at: PartitionTimeValue | undefined, timeZone?: string) {
  return getLocalDateTimeParts(at, normalizeTimeZone(timeZone));
}

function formatPartitionTimePrefix(options: PartitionNameOptions = {}): string {
  const parts = partitionTimeParts(options.at, options.timeZone);
  const sequence = String(Math.max(1, Math.floor(Number(options.sequence) || 1)));
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}-${parts.minute}-${parts.second}-${sequence}`;
}

function buildPartitionName(options: PartitionNameOptions = {}): string {
  const prefix = formatPartitionTimePrefix(options);
  const suffix = toString(options.suffix).trim();
  if (!suffix) return prefix;

  const preparedSuffix = options.sanitizeSuffix === false
  ? suffix
  : typeof options.sanitizeSuffix === "function"
  ? options.sanitizeSuffix(suffix)
  : suffix;

  return sanitizePartitionName(`${prefix}-${preparedSuffix}`);
}

function normalizePartitionKey(input: unknown): string {
  const raw = toString(input).trim();
  if (!raw) return "";
  return sanitizePartitionName(raw);
}

export {
  buildPartitionName,
  formatPartitionTimePrefix,
  normalizePartitionKey,
  sanitizePartitionName,
};
