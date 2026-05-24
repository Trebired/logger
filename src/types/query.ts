import type { LogEntry, LogLevelConfig } from "./common.js";

type LogQueryOptions = {
  level?: string;
  groupKey?: string;
  day?: string;
  hour?: string;
  limit?: number;
  partition?: string | null;
  acrossPartitions?: boolean;
  levels?: Record<string, LogLevelConfig>;
};

type LogQueryTotals = {
  logs: number;
  dirs: number;
  files: number;
};

type LogPartitionTotals = LogQueryTotals & {
  partitions: number;
};

type LogPartitionSummary = {
  partition: string | null;
  count: number;
  total: LogQueryTotals;
};

type LogQueryResult = {
  logs: LogEntry[];
  levels: Record<string, LogLevelConfig>;
  metadata: {
    dir: string;
    partition: string | null;
    count: number;
    total: LogQueryTotals;
    query: {
      level: string;
      groupKey: string;
      day: string;
      hour: string;
      limit: number;
      partition: string | null;
      acrossPartitions: boolean;
    };
    partitions: {
      items: LogPartitionSummary[];
      all: LogPartitionTotals;
    };
  };
};

export type {
  LogPartitionSummary,
  LogPartitionTotals,
  LogQueryOptions,
  LogQueryResult,
  LogQueryTotals,
};
