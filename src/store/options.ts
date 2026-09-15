import type {
  NormalizedRetentionOptions,
  NormalizedWriteOptions,
  RetentionOptions,
  WriteOptions,
} from "#e1h3ay0cyhgl";
import { parseSize } from "#unnkpg8o07bp";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DEFAULT_BATCH_SIZE = 2_000;
const MAX_BATCH_SIZE = 5_000;
const DEFAULT_FLUSH_INTERVAL_MS = 50;
const DEFAULT_MAX_QUEUE = 10_000;
const DEFAULT_MAX_AGE_DAYS = 14;
const DEFAULT_MAX_SIZE_BYTES = 256 * 1024 * 1024;
const DEFAULT_RETENTION_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_TEMPORARY_IDLE_HOURS = 24;

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeWriteOptions(input?: WriteOptions): NormalizedWriteOptions {
  const cfg = input || {};
  const batchSize = Math.min(MAX_BATCH_SIZE, Math.floor(positiveNumber(cfg.batchSize, DEFAULT_BATCH_SIZE)));
  const maxQueue = Math.floor(positiveNumber(cfg.maxQueue, DEFAULT_MAX_QUEUE));

  return {
    mode: cfg.mode === "sync" ? "sync" : "async",
    batchSize,
    flushIntervalMs: Math.floor(positiveNumber(cfg.flushIntervalMs, DEFAULT_FLUSH_INTERVAL_MS)),
    maxQueue: Math.max(maxQueue, batchSize),
    overflow:
    cfg.overflow === "drop-oldest" || cfg.overflow === "throw" || cfg.overflow === "drop-newest"
    ? cfg.overflow
    : "drop-newest",
  };
}

function normalizeRetentionOptions(input?: RetentionOptions): NormalizedRetentionOptions {
  const cfg = input || {};
  const maxAgeDays = cfg.maxAgeDays === false ? null : positiveNumber(cfg.maxAgeDays, DEFAULT_MAX_AGE_DAYS);
  const maxSizeBytes = cfg.maxSize === false ? null : parseSize(cfg.maxSize, DEFAULT_MAX_SIZE_BYTES);

  return {
    enabled: cfg.enabled !== false,
    maxAgeMs: maxAgeDays == null ? null : maxAgeDays * DAY_MS,
    maxSizeBytes,
    intervalMs: positiveNumber(cfg.intervalMs, DEFAULT_RETENTION_INTERVAL_MS),
    temporaryMaxIdleMs: positiveNumber(cfg.temporaryMaxIdleHours, DEFAULT_TEMPORARY_IDLE_HOURS) * HOUR_MS,
  };
}

export { normalizeRetentionOptions, normalizeWriteOptions };
