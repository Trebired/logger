import { normGroup } from "../groups.js";
import { minLevelWeight, normalizeLevel } from "../levels/index.js";
import { prepareMetadata } from "../metadata/process.js";
import type { LogEntry, LogLevelConfig, LogOrigin, RedactOptions } from "../types.js";
import { asObject, toString } from "../utils/values.js";

const DEFAULT_GROUP = "default";

type CommonLoggerOptions<TStats> = {
  levels: Record<string, LogLevelConfig>;
  minLevel?: string | number;
  defaultSource?: string;
  defaultGroup?: string;
  defaultMetadata?: Record<string, unknown>;
  serializers?: Record<string, (value: unknown) => unknown>;
  redact?: RedactOptions;
  sample?: number | ((entry: LogEntry) => boolean);
  getPartition?: () => string | null;
  writeEntry: (entry: LogEntry, levelConfig: LogLevelConfig) => void;
  flush: () => Promise<void>;
  close: () => Promise<void>;
  getStats: () => TStats;
};

function buildOrigin(source: unknown, instance: unknown = null): LogOrigin {
  const src = toString(source) || "app";
  const inst = instance == null ? null : String(instance);
  return {
    source: src,
    instance: inst || null,
  };
}

function parseCallArguments(argsLike: IArguments | unknown[], fallbackGroup: string) {
  const args = Array.isArray(argsLike) ? argsLike : Array.from(argsLike || []);
  const hasExplicitGroup = typeof args[0] === "string" && typeof args[1] === "string";

  return {
    group: hasExplicitGroup ? args[0] : fallbackGroup,
    message: hasExplicitGroup ? args[1] : String(args[0] ?? ""),
    metadata: hasExplicitGroup ? asObject(args[2]) : asObject(args[1]),
  };
}

function shouldKeepSample(entry: LogEntry, sample: CommonLoggerOptions<unknown>["sample"]): boolean {
  if (sample == null) return true;
  if (typeof sample === "number") {
    if (!Number.isFinite(sample)) return true;
    if (sample <= 0) return false;
    if (sample >= 1) return true;
    return Math.random() < sample;
  }
  if (typeof sample === "function") {
    try {
      return sample(entry) === true;
    } catch {
      return false;
    }
  }
  return true;
}

function createCommonLogger<TStats>(options: CommonLoggerOptions<TStats>) {
  const levels = options.levels;
  const threshold = minLevelWeight(options.minLevel, levels);
  const defaultSource = toString(options.defaultSource) || "app";
  const defaultGroup = normGroup(options.defaultGroup || DEFAULT_GROUP).key;
  const defaultMetadata = asObject(options.defaultMetadata);

  let enabled = true;
  let closed = false;

  function emit(levelInput: string, groupInput: unknown, messageInput: unknown, metadataInput?: unknown, originInput?: Partial<LogOrigin>): void {
    if (!enabled || closed) return;

    const level = normalizeLevel(levelInput, levels);
    const levelConfig = levels[level] || levels.info;
    if (levelConfig.weight < threshold) return;

    const rawMetadata = {
      ...defaultMetadata,
      ...asObject(metadataInput),
    };
    const recordedAt = toString(rawMetadata.__recorded_at) || new Date().toISOString();
    const metadata = prepareMetadata(rawMetadata, options.serializers, options.redact);
    const group = normGroup(groupInput || defaultGroup).key;
    const message = typeof messageInput === "string" ? messageInput : String(messageInput ?? "");
    const originSource = originInput && originInput.source ? originInput.source : defaultSource;
    const originInstance = originInput && Object.prototype.hasOwnProperty.call(originInput, "instance") ? originInput.instance : null;
    const entry: LogEntry = {
      recorded_at: recordedAt,
      level,
      group,
      message,
      origin: buildOrigin(originSource, originInstance),
    };
    if (typeof options.getPartition === "function") entry.partition = options.getPartition() ?? null;
    if (Object.keys(metadata).length) entry.metadata = metadata;

    if (!shouldKeepSample(entry, options.sample)) return;

    options.writeEntry(entry, levelConfig);
  }

  function bindGroup(groupName: unknown, originInput?: Partial<LogOrigin>, extraMetadata?: Record<string, unknown>): Record<string, any> {
    const boundGroup = normGroup(groupName || defaultGroup).key;
    const mergedExtraMetadata = asObject(extraMetadata);
    const grouped: Record<string, any> = {};

    for (const level of Object.keys(levels)) {
      grouped[level] = (message: unknown, metadata?: unknown) =>
        emit(level, boundGroup, message, { ...mergedExtraMetadata, ...asObject(metadata) }, originInput);
    }

    grouped.child = (moreMetadata?: unknown) =>
      bindGroup(boundGroup, originInput, { ...mergedExtraMetadata, ...asObject(moreMetadata) });

    return grouped;
  }

  const api: Record<string, any> = {
    group(groupName?: string) {
      return bindGroup(groupName || defaultGroup);
    },
    withScope(source?: string | null, groupName?: string, instance?: string | number | null) {
      const originInput = {
        source: toString(source) || defaultSource,
        instance: instance == null ? null : String(instance),
      };
      return bindGroup(groupName || defaultGroup, originInput);
    },
    setEnabled(flag: boolean) {
      enabled = Boolean(flag);
    },
    logError(error: unknown, metadata?: Record<string, unknown>, source?: string) {
      const meta = asObject(metadata);
      const groupName = toString(meta.group) || defaultGroup;
      const originSource = toString(source) || defaultSource;
      if (error instanceof Error) {
        emit("error", groupName, error.message, { ...meta, stack: error.stack }, { source: originSource });
        return;
      }
      emit("error", groupName, String(error), meta, { source: originSource });
    },
    flush() {
      return options.flush();
    },
    async close() {
      if (closed) return;
      closed = true;
      await options.close();
    },
    getStats() {
      return options.getStats();
    },
  };

  for (const level of Object.keys(levels)) {
    api[level] = function levelLogger(this: unknown): void {
      const parsed = parseCallArguments(arguments, defaultGroup);
      emit(level, parsed.group, parsed.message, parsed.metadata);
    };
  }

  return {
    api,
    emit,
  };
}

export { DEFAULT_GROUP, buildOrigin, createCommonLogger, parseCallArguments, shouldKeepSample };
export type { CommonLoggerOptions };
