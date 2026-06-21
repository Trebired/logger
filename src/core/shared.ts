import { normGroup } from "#8xmnu037caa7";
import { minLevelWeight, normalizeLevel } from "#g4tupkl7rvk4";
import { prepareMetadata } from "#kzmqayr84v3x";
import type { LogEntry, LogLevelConfig, LogOrigin, RedactOptions } from "#tvzweoxg5ahk";
import { asObject, toString } from "#ycytzc4gr3f7";

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
  const emit = createEmitter({
    defaultGroup,
    defaultMetadata,
    defaultSource,
    enabled: () => enabled,
    closed: () => closed,
    levels,
    options,
    threshold,
  });
  const bindGroup = createGroupBinder({
    defaultGroup,
    defaultSource,
    levels,
    emit,
  });
  const api = createLoggerApi({
    bindGroup,
    defaultGroup,
    defaultSource,
    emit,
    options,
    setClosed(value) {
      closed = value;
    },
    setEnabled(value) {
      enabled = value;
    },
  });
  attachLevelLoggers(api, levels, defaultGroup, emit);

  return {
    api,
    emit,
  };
}

function createEmitter(args: {
  defaultGroup: string;
  defaultMetadata: Record<string, unknown>;
  defaultSource: string;
  enabled: () => boolean;
  closed: () => boolean;
  levels: Record<string, LogLevelConfig>;
  options: CommonLoggerOptions<unknown>;
  threshold: number;
}) {
  return function emit(
    levelInput: string,
    groupInput: unknown,
    messageInput: unknown,
    metadataInput?: unknown,
    originInput?: Partial<LogOrigin>,
  ): void {
    if (!args.enabled() || args.closed()) return;

    const prepared = prepareEntry({
      defaultGroup: args.defaultGroup,
      defaultMetadata: args.defaultMetadata,
      defaultSource: args.defaultSource,
      groupInput,
      levels: args.levels,
      messageInput,
      metadataInput,
      options: args.options,
      originInput,
      threshold: args.threshold,
      levelInput,
    });

    if (!prepared || !shouldKeepSample(prepared.entry, args.options.sample)) {
      return;
    }

    args.options.writeEntry(prepared.entry, prepared.levelConfig);
  };
}

function createGroupBinder(args: {
  defaultGroup: string;
  defaultSource: string;
  levels: Record<string, LogLevelConfig>;
  emit: (
    levelInput: string,
    groupInput: unknown,
    messageInput: unknown,
    metadataInput?: unknown,
    originInput?: Partial<LogOrigin>,
  ) => void;
}) {
  return function bindGroup(
    groupName: unknown,
    originInput?: Partial<LogOrigin>,
    extraMetadata?: Record<string, unknown>,
  ): Record<string, any> {
    const boundGroup = normGroup(groupName || args.defaultGroup).key;
    const mergedExtraMetadata = asObject(extraMetadata);
    const grouped: Record<string, any> = {};

    for (const level of Object.keys(args.levels)) {
      grouped[level] = (message: unknown, metadata?: unknown) =>
        args.emit(
          level,
          boundGroup,
          message,
          { ...mergedExtraMetadata, ...asObject(metadata) },
          originInput,
        );
    }

    grouped.child = (moreMetadata?: unknown) =>
      bindGroup(boundGroup, originInput, { ...mergedExtraMetadata, ...asObject(moreMetadata) });

    return grouped;
  };
}

function createLoggerApi(args: {
  bindGroup: (
    groupName: unknown,
    originInput?: Partial<LogOrigin>,
    extraMetadata?: Record<string, unknown>,
  ) => Record<string, any>;
  defaultGroup: string;
  defaultSource: string;
  emit: (
    levelInput: string,
    groupInput: unknown,
    messageInput: unknown,
    metadataInput?: unknown,
    originInput?: Partial<LogOrigin>,
  ) => void;
  options: CommonLoggerOptions<unknown>;
  setClosed: (value: boolean) => void;
  setEnabled: (value: boolean) => void;
}): Record<string, any> {
  return {
    group(groupName?: string) {
      return args.bindGroup(groupName || args.defaultGroup);
    },
    withScope(source?: string | null, groupName?: string, instance?: string | number | null) {
      return args.bindGroup(groupName || args.defaultGroup, {
        source: toString(source) || args.defaultSource,
        instance: instance == null ? null : String(instance),
      });
    },
    setEnabled(flag: boolean) {
      args.setEnabled(Boolean(flag));
    },
    logError(error: unknown, metadata?: Record<string, unknown>, source?: string) {
      emitLogError(args.emit, error, metadata, source, args.defaultGroup, args.defaultSource);
    },
    flush() {
      return args.options.flush();
    },
    async close() {
      args.setClosed(true);
      await args.options.close();
    },
    getStats() {
      return args.options.getStats();
    },
  };
}

function emitLogError(
  emit: (
    levelInput: string,
    groupInput: unknown,
    messageInput: unknown,
    metadataInput?: unknown,
    originInput?: Partial<LogOrigin>,
  ) => void,
  error: unknown,
  metadata: Record<string, unknown> | undefined,
  source: string | undefined,
  defaultGroup: string,
  defaultSource: string,
): void {
  const meta = asObject(metadata);
  const groupName = toString(meta.group) || defaultGroup;
  const originSource = toString(source) || defaultSource;

  if (error instanceof Error) {
    emit("error", groupName, error.message, { ...meta, stack: error.stack }, { source: originSource });
    return;
  }

  emit("error", groupName, String(error), meta, { source: originSource });
}

function attachLevelLoggers(
  api: Record<string, any>,
  levels: Record<string, LogLevelConfig>,
  defaultGroup: string,
  emit: (
    levelInput: string,
    groupInput: unknown,
    messageInput: unknown,
    metadataInput?: unknown,
    originInput?: Partial<LogOrigin>,
  ) => void,
): void {
  for (const level of Object.keys(levels)) {
    api[level] = function levelLogger(this: unknown): void {
      const parsed = parseCallArguments(arguments, defaultGroup);
      emit(level, parsed.group, parsed.message, parsed.metadata);
    };
  }
}

function prepareEntry(args: {
  defaultGroup: string;
  defaultMetadata: Record<string, unknown>;
  defaultSource: string;
  groupInput: unknown;
  levels: Record<string, LogLevelConfig>;
  levelInput: string;
  messageInput: unknown;
  metadataInput: unknown;
  options: CommonLoggerOptions<unknown>;
  originInput?: Partial<LogOrigin>;
  threshold: number;
}): { entry: LogEntry; levelConfig: LogLevelConfig } | null {
  const level = normalizeLevel(args.levelInput, args.levels);
  const levelConfig = args.levels[level] || args.levels.info;
  if (levelConfig.weight < args.threshold) {
    return null;
  }

  const rawMetadata = {
    ...args.defaultMetadata,
    ...asObject(args.metadataInput),
  };
  const recordedAt = toString(rawMetadata.__recorded_at) || new Date().toISOString();
  const metadata = prepareMetadata(rawMetadata, args.options.serializers, args.options.redact);
  const originSource = args.originInput?.source || args.defaultSource;
  const originInstance = Object.prototype.hasOwnProperty.call(args.originInput || {}, "instance")
    ? args.originInput?.instance
    : null;
  const entry: LogEntry = {
    recorded_at: recordedAt,
    level,
    group: normGroup(args.groupInput || args.defaultGroup).key,
    message: typeof args.messageInput === "string" ? args.messageInput : String(args.messageInput ?? ""),
    origin: buildOrigin(originSource, originInstance),
  };

  if (typeof args.options.getPartition === "function") {
    entry.partition = args.options.getPartition() ?? null;
  }

  if (Object.keys(metadata).length) {
    entry.metadata = metadata;
  }

  return {
    entry,
    levelConfig,
  };
}

export { DEFAULT_GROUP, buildOrigin, createCommonLogger, parseCallArguments, shouldKeepSample };
export type { CommonLoggerOptions };
