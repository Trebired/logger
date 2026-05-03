import type { NormalizedRetentionOptions, NormalizedWriteOptions, RetentionOptions, WriteOptions } from "../types.js";
import { parseSize } from "../utils/size.js";

function normalizeWriteOptions(input?: WriteOptions): NormalizedWriteOptions {
  const cfg = input || {};
  const maxQueue = Number(cfg.maxQueue);

  return {
    mode: cfg.mode === "sync" ? "sync" : "async",
    maxQueue: Number.isFinite(maxQueue) && maxQueue > 0 ? Math.floor(maxQueue) : 10000,
    overflow:
      cfg.overflow === "drop-oldest" || cfg.overflow === "throw" || cfg.overflow === "drop-newest"
        ? cfg.overflow
        : "drop-newest",
  };
}

function normalizeRetentionOptions(input?: RetentionOptions): NormalizedRetentionOptions {
  const cfg = input || {};
  const days = Number(cfg.maxAgeDays);
  const cleanupIntervalMs = Number(cfg.cleanupIntervalMs);

  return {
    enabled: cfg.enabled !== false,
    maxAgeDays: Number.isFinite(days) && days > 0 ? days : 7,
    maxFileSize: parseSize(cfg.maxFileSize, 20 * 1024 * 1024),
    compressOldFiles: cfg.compressOldFiles === true,
    cleanupIntervalMs: Number.isFinite(cleanupIntervalMs) && cleanupIntervalMs > 0 ? cleanupIntervalMs : 60 * 60 * 1000,
  };
}

export { normalizeRetentionOptions, normalizeWriteOptions };
