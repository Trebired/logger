import type {
  ListGroupsOptions,
  LogGroupSummary,
  LogLevelConfig,
  LogQueryOptions,
  LogQueryResult,
} from "#e1h3ay0cyhgl";
import { toTrimmedString as toString } from "@trebired/utils";
import { escapeLikePattern, groupIdsForPrefix } from "./groups.js";
import type { LogStore } from "./open.js";
import { partitionIdByName } from "./partitions.js";
import { ENTRY_COLUMNS, ENTRY_FROM, entryFromRow, isoOrNull, toEpochMs, type EntryRow } from "./rows.js";

const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 1000;
const MAX_FAN_OUT_QUERIES = 64;

type SqlValue = string | number;

type SqlFilter = {
  clauses: string[];
  params: SqlValue[];
  partitionIds: number[] | null;
  levels: string[] | null;
  groupIds: number[] | null;
};

type QueryCursor = {
  recordedAt: number;
  rowId: number;
};

type PageRequest = {
  order: "ASC" | "DESC";
  cursor: QueryCursor | null;
  take: number;
  offset: number;
};

function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

function clampLimit(input: unknown): number {
  const value = Math.floor(Number(input));
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_QUERY_LIMIT;
  return Math.min(value, MAX_QUERY_LIMIT);
}

function addPartitionFilter(store: LogStore, options: LogQueryOptions, filter: SqlFilter): boolean {
  if (options.partition === undefined || options.partition === "*") return true;
  const partitionId = partitionIdByName(store, options.partition == null ? null : toString(options.partition));
  if (partitionId == null) return false;
  filter.partitionIds = [partitionId];
  return true;
}

function allowedLevels(options: LogQueryOptions, levels: Record<string, LogLevelConfig>): string[] | null {
  const explicit = Array.isArray(options.level) ? options.level : options.level ? [options.level] : [];
  const named = explicit.map((level) => toString(level).toLowerCase()).filter((level) => level && level !== "all");
  const minimum = toString(options.minLevel).toLowerCase();
  const threshold = minimum && levels[minimum] ? levels[minimum].weight : null;
  const byWeight = threshold == null
  ? null
  : Object.keys(levels).filter((level) => levels[level].weight >= threshold);

  if (!named.length) return byWeight;
  return byWeight ? named.filter((level) => byWeight.includes(level)) : named;
}

function addLevelFilter(options: LogQueryOptions, levels: Record<string, LogLevelConfig>, filter: SqlFilter): boolean {
  const list = allowedLevels(options, levels);
  if (list == null) return true;
  if (!list.length) return false;
  filter.levels = Array.from(new Set(list));
  return true;
}

function addGroupFilter(store: LogStore, options: LogQueryOptions, filter: SqlFilter): boolean {
  const group = toString(options.group);
  if (!group || group === "all") return true;
  const groupIds = groupIdsForPrefix(store, group);
  if (!groupIds.length) return false;
  filter.groupIds = groupIds;
  return true;
}

function addTimeAndSearchFilters(options: LogQueryOptions, filter: SqlFilter): void {
  const since = toEpochMs(options.since);
  const until = toEpochMs(options.until);
  const search = toString(options.search);
  if (since != null) {
    filter.clauses.push("e.recorded_at >= ?");
    filter.params.push(since);
  }
  if (until != null) {
    filter.clauses.push("e.recorded_at <= ?");
    filter.params.push(until);
  }
  if (search) {
    filter.clauses.push("e.message LIKE ? ESCAPE '\\'");
    filter.params.push(`%${escapeLikePattern(search)}%`);
  }
}

function buildFilter(
  store: LogStore,
  options: LogQueryOptions,
  levels: Record<string, LogLevelConfig>,
): SqlFilter | null {
  const filter: SqlFilter = { clauses: [], params: [], partitionIds: null, levels: null, groupIds: null };
  if (!addPartitionFilter(store, options, filter)) return null;
  if (!addLevelFilter(options, levels, filter)) return null;
  if (!addGroupFilter(store, options, filter)) return null;
  addTimeAndSearchFilters(options, filter);
  return filter;
}

function encodeCursor(row: EntryRow): string {
  return Buffer.from(`${row.recorded_at}:${row.id}`, "utf8").toString("base64url");
}

function decodeCursor(input: unknown): QueryCursor | null {
  const raw = toString(input);
  if (!raw) return null;
  const [recordedAt, rowId] = Buffer.from(raw, "base64url").toString("utf8").split(":").map(Number);
  return Number.isFinite(recordedAt) && Number.isFinite(rowId) ? { recordedAt, rowId } : null;
}

function pushValues(clauses: string[], params: SqlValue[], column: string, values: SqlValue[] | null): void {
  if (!values) return;
  clauses.push(values.length === 1 ? `${column} = ?` : `${column} IN (${placeholders(values.length)})`);
  params.push(...values);
}

function whereOf(filter: SqlFilter, request: PageRequest | null): { sql: string; params: SqlValue[] } {
  const clauses = [...filter.clauses];
  const params = [...filter.params];
  pushValues(clauses, params, "e.partition_id", filter.partitionIds);
  pushValues(clauses, params, "e.level", filter.levels);
  pushValues(clauses, params, "e.group_id", filter.groupIds);
  if (request && request.cursor) {
    const { recordedAt, rowId } = request.cursor;
    clauses.push(request.order === "DESC"
      ? "e.recorded_at <= ? AND (e.recorded_at < ? OR e.id < ?)"
      : "e.recorded_at >= ? AND (e.recorded_at > ? OR e.id > ?)");
    params.push(recordedAt, recordedAt, rowId);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function partitionIdsWithEntries(store: LogStore): number[] {
  const rows = store.statement("SELECT id FROM partitions WHERE entry_count > 0 ORDER BY id").all() as Array<{id:number}>;
  return rows.map((row) => row.id);
}

function splitValues<T>(values: T[] | null, expand: boolean): Array<T[]|null> {
  if (!values) return [null];
  return expand ? values.map((value) => [value]) : [values];
}

function fanOutFilters(store: LogStore, filter: SqlFilter): SqlFilter[] {
  const narrowed = filter.levels != null || filter.groupIds != null;
  const partitionIds = filter.partitionIds ?? (narrowed ? partitionIdsWithEntries(store) : null);
  const partitions = splitValues(partitionIds, true);
  const levels = splitValues(filter.levels, true);
  const groups = splitValues(filter.groupIds, filter.levels == null);
  if (partitions.length * levels.length * groups.length > MAX_FAN_OUT_QUERIES) return [filter];

  const filters: SqlFilter[] = [];
  for (const partition of partitions) {
    for (const level of levels) {
      for (const group of groups) filters.push({ ...filter, partitionIds: partition, levels: level, groupIds: group });
    }
  }
  return filters;
}

function selectRows(store: LogStore, filter: SqlFilter, request: PageRequest): EntryRow[] {
  const where = whereOf(filter, request);
  const sql = `SELECT ${ENTRY_COLUMNS} FROM ${ENTRY_FROM} ${where.sql}
  ORDER BY e.recorded_at ${request.order}, e.id ${request.order} LIMIT ? OFFSET ?`;
  return store.statement(sql).all(...where.params, request.take, request.offset) as EntryRow[];
}

function compareRows(order: "ASC" | "DESC"): (left: EntryRow, right: EntryRow) => number {
  const direction = order === "ASC" ? 1 : -1;
  return (left, right) => direction * (left.recorded_at - right.recorded_at || left.id - right.id);
}

function readFanOut(store: LogStore, filters: SqlFilter[], request: PageRequest): EntryRow[] {
  const perQuery: PageRequest = { ...request, take: request.offset + request.take, offset: 0 };
  const rows = filters.flatMap((item) => selectRows(store, item, perQuery));
  return rows.sort(compareRows(request.order)).slice(request.offset, request.offset + request.take);
}

function readPage(store: LogStore, filter: SqlFilter, options: LogQueryOptions, limit: number) {
  const cursor = decodeCursor(options.cursor);
  const request: PageRequest = {
    order: options.order === "asc" ? "ASC" : "DESC",
    cursor,
    take: limit + 1,
    offset: !cursor && Number(options.offset) > 0 ? Math.floor(Number(options.offset)) : 0,
  };
  const filters = fanOutFilters(store, filter);
  const rows = filters.length === 1 ? selectRows(store, filters[0], request) : readFanOut(store, filters, request);
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  return { rows, hasMore };
}

function countEntries(store: LogStore, filter: SqlFilter): number {
  return fanOutFilters(store, filter).reduce((total, item) => {
      const where = whereOf(item, null);
      const row = store.statement(`SELECT COUNT(*) AS total FROM entries e ${where.sql}`).get(...where.params) as { total: number };
      return total + (Number(row.total) || 0);
    }, 0);
}

function queryStore(
  store: LogStore,
  options: LogQueryOptions = {},
  levels: Record<string, LogLevelConfig>,
): LogQueryResult {
  const filter = buildFilter(store, options, levels);
  if (!filter) {
    return { entries: [], nextCursor: null, hasMore: false, total: options.count ? 0 : null, levels };
  }
  const limit = clampLimit(options.limit);
  const page = readPage(store, filter, options, limit);
  const last = page.rows[page.rows.length - 1];
  return {
    entries: page.rows.map(entryFromRow),
    nextCursor: page.hasMore && last ? encodeCursor(last) : null,
    hasMore: page.hasMore,
    total: options.count ? countEntries(store, filter) : null,
    levels,
  };
}

function listStoreGroups(store: LogStore, options: ListGroupsOptions = {}): LogGroupSummary[] {
  const scoped = options.partition !== undefined && options.partition !== "*";
  const partitionId = scoped ? partitionIdByName(store, options.partition == null ? null : toString(options.partition)) : null;
  if (scoped && partitionId == null) return [];

  const sql = scoped
  ? `SELECT g.key AS group_key, pg.entry_count AS entry_count, pg.last_at AS last_at
  FROM partition_groups pg JOIN groups g ON g.id = pg.group_id
  WHERE pg.partition_id = ? AND pg.entry_count > 0 ORDER BY g.key`
  : `SELECT g.key AS group_key, SUM(pg.entry_count) AS entry_count, MAX(pg.last_at) AS last_at
  FROM partition_groups pg JOIN groups g ON g.id = pg.group_id
  GROUP BY g.key HAVING SUM(pg.entry_count) > 0 ORDER BY g.key`;
  const rows = (scoped ? store.statement(sql).all(partitionId as number) : store.statement(sql).all()) as Array<{
    group_key: string;
    entry_count: number;
    last_at: number | null;
  }>;
  return rows.map((row) => ({ group: row.group_key, entries: Number(row.entry_count) || 0, lastAt: isoOrNull(row.last_at) }));
}

export { clampLimit, listStoreGroups, queryStore };
