import type { LogQueryOptions, LogQueryTotals } from "#tvzweoxg5ahk";
import { toString } from "#ycytzc4gr3f7";
import { sanitizePartitionName, type WalkedLogFile } from "#x2qkmwodgsce";

type PartitionSummaryState = {
  partition: string | null;
  total: LogQueryTotals;
};

function partitionKey(partition: string | null | undefined): string {
  return partition || "__unpartitioned__";
}

function normalizePartitionFilter(input: unknown): string | null {
  if (input == null) return null;
  const raw = toString(input).trim();
  if (!raw) return null;
  return sanitizePartitionName(raw);
}

function fileMatchesFilters(file: WalkedLogFile, options: LogQueryOptions): boolean {
  const level = toString(options.level || "all").toLowerCase() || "all";
  const groupKey = toString(options.groupKey || "all") || "all";
  const day = toString(options.day);
  const hour = toString(options.hour);

  if (day && file.day !== day) return false;
  if (hour && file.hour !== hour) return false;
  if (groupKey !== "all" && file.groupKey !== groupKey) return false;
  if (level !== "all" && file.level !== level) return false;
  return true;
}

function scopeMatches(file: WalkedLogFile, partition: string | null | undefined, acrossPartitions: boolean): boolean {
  if (acrossPartitions) return true;
  if (partition == null) return file.partition == null;
  return file.partition === partition;
}

export { fileMatchesFilters, normalizePartitionFilter, partitionKey, scopeMatches };
export type { PartitionSummaryState };
