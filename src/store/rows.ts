import type { LogEntry } from "#e1h3ay0cyhgl";
import { hasOwnKeys } from "#rb1c0idcezok";

type EntryRow = {
  id: number;
  recorded_at: number;
  level: string;
  group_key: string;
  partition_name: string;
  source: string;
  instance: string | null;
  message: string;
  metadata: string | null;
};

const ENTRY_COLUMNS = [
  "e.id",
  "e.recorded_at",
  "e.level",
  "g.key AS group_key",
  "p.name AS partition_name",
  "e.source",
  "e.instance",
  "e.message",
  "e.metadata",
].join(", ");

const ENTRY_FROM = "entries e JOIN groups g ON g.id = e.group_id JOIN partitions p ON p.id = e.partition_id";

function toEpochMs(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? Math.floor(value) : null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function isoOrNull(value: number | null | undefined): string | null {
  return value == null ? null : new Date(value).toISOString();
}

function parseMetadata(raw: string | null): Record<string, unknown>|undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function entryFromRow(row: EntryRow): LogEntry {
  const entry: LogEntry = {
    recorded_at: new Date(row.recorded_at).toISOString(),
    level: row.level,
    group: row.group_key,
    message: row.message,
    origin: {
      source: row.source,
      instance: row.instance ?? null,
    },
    partition: row.partition_name || null,
  };
  const metadata = parseMetadata(row.metadata);
  if (metadata) entry.metadata = metadata;
  return entry;
}

function serializeMetadata(metadata: Record<string, unknown>|undefined): string | null {
  if (!metadata || !hasOwnKeys(metadata)) return null;
  try {
    return JSON.stringify(metadata);
  } catch {
    return JSON.stringify({ serialization_error: "metadata could not be serialized" });
  }
}

export { ENTRY_COLUMNS, ENTRY_FROM, entryFromRow, isoOrNull, serializeMetadata, toEpochMs };
export type { EntryRow };
