import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { PARTITION_MARKER_FILE } from "../constants.js";
import { normGroup } from "../groups.js";
import type {
  CopyPartitionOptions,
  CreatePartitionOptions,
  DeleteLogsOptions,
  DeleteLogsResult,
  DeletePartitionResult,
  DeletePartitionsOptions,
  LogEntry,
  MergePartitionOptions,
  MovePartitionOptions,
  PartitionInfo,
  RenamePartitionOptions,
} from "../types.js";
import { toString } from "../utils/values.js";
import { makeLogFileName, sanitizePartitionName, walkedFileFromPath, type WalkedLogFile } from "./names.js";

type PartitionMarker = {
  name: string;
  temporary: boolean;
  created_at: string;
  updated_at: string;
};

type PartitionRecord = {
  dir: string;
  name: string;
  path: string;
  marker: PartitionMarker;
};

type PartitionWriteOptions = {
  temporary?: boolean;
  preserveTemporary?: boolean;
  createdAt?: string;
  updatedAt?: string;
  preserveCreatedAt?: boolean;
};

type PartitionTransformOptions = {
  source: PartitionRecord;
  targetDir: string;
  targetName: string;
  deleteSource: boolean;
  targetTemporary: boolean;
  preserveSourceCreatedAt: boolean;
};

type PartitionDeleteCandidate = {
  info: PartitionInfo;
  record: PartitionRecord;
};

type DeleteLogCandidate = {
  file: WalkedLogFile;
  bytes: number;
  logs: number;
};

function resolveDir(input: string): string {
  const raw = toString(input).trim();
  return raw ? path.resolve(raw) : "";
}

function partitionRootPath(dir: string, partition: string): string {
  return path.join(dir, partition);
}

function isValidMarker(value: unknown, expectedName?: string): value is PartitionMarker {
  if (!value || typeof value !== "object") return false;
  const marker = value as Record<string, unknown>;
  if (toString(marker.name) !== (expectedName || toString(marker.name))) return false;
  if (typeof marker.temporary !== "boolean") return false;
  if (!toString(marker.created_at)) return false;
  if (!toString(marker.updated_at)) return false;
  return true;
}

function markerPath(rootDir: string): string {
  return path.join(rootDir, PARTITION_MARKER_FILE);
}

async function readPartitionMarkerFromRoot(rootDir: string, expectedName?: string): Promise<PartitionMarker | null> {
  try {
    const text = await fs.promises.readFile(markerPath(rootDir), "utf8");
    const parsed = JSON.parse(text);
    return isValidMarker(parsed, expectedName) ? parsed : null;
  } catch {
    return null;
  }
}

function readPartitionMarkerFromRootSync(rootDir: string, expectedName?: string): PartitionMarker | null {
  try {
    const text = fs.readFileSync(markerPath(rootDir), "utf8");
    const parsed = JSON.parse(text);
    return isValidMarker(parsed, expectedName) ? parsed : null;
  } catch {
    return null;
  }
}

function nextMarker(existing: PartitionMarker | null, name: string, options: PartitionWriteOptions = {}): PartitionMarker {
  const now = options.updatedAt || new Date().toISOString();
  const created_at = options.createdAt
    || ((options.preserveCreatedAt !== false && existing?.created_at) ? existing.created_at : now);
  const temporary = typeof options.temporary === "boolean"
    ? options.temporary
    : (options.preserveTemporary !== false && existing ? existing.temporary : false);

  return {
    name,
    temporary,
    created_at,
    updated_at: now,
  };
}

async function writePartitionMarker(rootDir: string, marker: PartitionMarker): Promise<void> {
  await fs.promises.mkdir(rootDir, { recursive: true });
  await fs.promises.writeFile(markerPath(rootDir), `${JSON.stringify(marker)}\n`, "utf8");
}

function writePartitionMarkerSync(rootDir: string, marker: PartitionMarker): void {
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(markerPath(rootDir), `${JSON.stringify(marker)}\n`, "utf8");
}

async function touchPartitionMarker(dir: string, partition: string, options: PartitionWriteOptions = {}): Promise<PartitionMarker> {
  const baseDir = resolveDir(dir);
  if (!baseDir) throw new Error("missing-log-dir");
  const name = sanitizePartitionName(partition);
  const rootDir = partitionRootPath(baseDir, name);
  const existing = await readPartitionMarkerFromRoot(rootDir, name);
  const marker = nextMarker(existing, name, options);
  await writePartitionMarker(rootDir, marker);
  return marker;
}

function touchPartitionMarkerSync(dir: string, partition: string, options: PartitionWriteOptions = {}): PartitionMarker {
  const baseDir = resolveDir(dir);
  if (!baseDir) throw new Error("missing-log-dir");
  const name = sanitizePartitionName(partition);
  const rootDir = partitionRootPath(baseDir, name);
  const existing = readPartitionMarkerFromRootSync(rootDir, name);
  const marker = nextMarker(existing, name, options);
  writePartitionMarkerSync(rootDir, marker);
  return marker;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectPartitionRecords(dir: string): Promise<PartitionRecord[]> {
  const baseDir = resolveDir(dir);
  if (!baseDir) return [];
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: PartitionRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const rootDir = path.join(baseDir, name);
    const marker = await readPartitionMarkerFromRoot(rootDir, name);
    if (!marker) continue;
    out.push({ dir: baseDir, name, path: rootDir, marker });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function getPartitionRecord(dir: string, partition: string): Promise<PartitionRecord | null> {
  const baseDir = resolveDir(dir);
  if (!baseDir) return null;
  const name = sanitizePartitionName(partition);
  const rootDir = partitionRootPath(baseDir, name);
  const marker = await readPartitionMarkerFromRoot(rootDir, name);
  if (!marker) return null;
  return { dir: baseDir, name, path: rootDir, marker };
}

async function requirePartitionRecord(dir: string, partition: string): Promise<PartitionRecord> {
  const record = await getPartitionRecord(dir, partition);
  if (!record) throw new Error(`partition-not-found: ${partition}`);
  return record;
}

async function readLogRows(filePath: string, compressed: boolean): Promise<LogEntry[]> {
  try {
    const data = await fs.promises.readFile(filePath);
    const text = compressed ? zlib.gunzipSync(data).toString("utf8") : data.toString("utf8");
    if (!text.trim()) return [];
    const rows: LogEntry[] = [];

    for (const line of text.trim().split("\n")) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object") rows.push(parsed);
      } catch {}
    }

    return rows;
  } catch {
    return [];
  }
}

async function writeLogRows(filePath: string, rows: LogEntry[], compressed: boolean): Promise<void> {
  const payload = rows.length ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
  if (compressed) {
    const zipped = zlib.gzipSync(Buffer.from(payload, "utf8"));
    await fs.promises.writeFile(filePath, zipped);
    return;
  }
  await fs.promises.writeFile(filePath, payload, "utf8");
}

async function collectPartitionFiles(record: PartitionRecord): Promise<WalkedLogFile[]> {
  const out: WalkedLogFile[] = [];
  const stack = [record.path];

  while (stack.length) {
    const current = stack.pop() || "";
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
        continue;
      }
      if (!entry.isFile() || entry.name === PARTITION_MARKER_FILE) continue;
      const walked = walkedFileFromPath(record.path, absPath, record.name, record.path);
      if (walked) out.push(walked);
    }
  }

  out.sort((a, b) => a.absPath.localeCompare(b.absPath));
  return out;
}

async function partitionInfoFromRecord(record: PartitionRecord): Promise<PartitionInfo> {
  const files = await collectPartitionFiles(record);
  const dirs = new Set<string>();
  let bytes = 0;
  let logs = 0;
  let lastActivityMs = 0;

  for (const file of files) {
    try {
      const stat = await fs.promises.stat(file.absPath);
      bytes += stat.size;
      if (stat.mtimeMs > lastActivityMs) lastActivityMs = stat.mtimeMs;
    } catch {}
    dirs.add(file.relDir || ".");
    logs += (await readLogRows(file.absPath, file.compressed)).length;
  }

  return {
    name: record.name,
    path: record.path,
    temporary: record.marker.temporary,
    created_at: record.marker.created_at,
    updated_at: record.marker.updated_at,
    last_activity_at: lastActivityMs > 0 ? new Date(lastActivityMs).toISOString() : null,
    total: {
      logs,
      dirs: dirs.size,
      files: files.length,
      bytes,
    },
  };
}

function fileStamp(file: WalkedLogFile): string {
  return `${file.day}-${file.hour}`;
}

async function findAvailableTargetPath(dir: string, file: WalkedLogFile): Promise<string> {
  let sequence = file.sequence;
  for (;;) {
    const fileName = makeLogFileName(fileStamp(file), sequence, file.level);
    const plainTarget = path.join(dir, fileName);
    const gzipTarget = path.join(dir, `${fileName}.gz`);
    if (!(await pathExists(plainTarget)) && !(await pathExists(gzipTarget))) {
      return file.compressed ? gzipTarget : plainTarget;
    }
    sequence += 1;
  }
}

async function writePartitionFiles(source: PartitionRecord, targetRoot: string, targetName: string, merge: boolean): Promise<void> {
  const files = await collectPartitionFiles(source);

  for (const file of files) {
    const rows = await readLogRows(file.absPath, file.compressed);
    const nextRows = rows.map((row) => ({ ...row, partition: targetName }));
    const targetDir = file.groupDir ? path.join(targetRoot, file.groupDir) : targetRoot;
    await fs.promises.mkdir(targetDir, { recursive: true });
    const targetPath = merge
      ? await findAvailableTargetPath(targetDir, file)
      : path.join(targetDir, path.basename(file.absPath));
    await writeLogRows(targetPath, nextRows, file.compressed);
  }
}

async function transformPartition(options: PartitionTransformOptions): Promise<PartitionInfo> {
  const targetDir = resolveDir(options.targetDir);
  if (!targetDir) throw new Error("missing-log-dir");
  const targetName = sanitizePartitionName(options.targetName);
  const targetRoot = partitionRootPath(targetDir, targetName);

  if (options.source.path === targetRoot) {
    await touchPartitionMarker(targetDir, targetName, {
      temporary: options.targetTemporary,
      createdAt: options.source.marker.created_at,
      preserveCreatedAt: false,
    });
    return (await getPartitionInfo(targetDir, targetName)) as PartitionInfo;
  }

  if (await pathExists(targetRoot)) throw new Error(`partition-already-exists: ${targetName}`);

  const tempRoot = path.join(targetDir, `.trebired-partition-build-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    await fs.promises.mkdir(targetDir, { recursive: true });
    await writePartitionFiles(options.source, tempRoot, targetName, false);
    await writePartitionMarker(tempRoot, {
      name: targetName,
      temporary: options.targetTemporary,
      created_at: options.preserveSourceCreatedAt ? options.source.marker.created_at : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await fs.promises.rename(tempRoot, targetRoot);
    if (options.deleteSource) await fs.promises.rm(options.source.path, { recursive: true, force: true });
    return (await getPartitionInfo(targetDir, targetName)) as PartitionInfo;
  } catch (error) {
    await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function mergePartitionRecord(source: PartitionRecord, target: PartitionRecord, temporary: boolean): Promise<PartitionInfo> {
  if (source.path === target.path) throw new Error(`partition-merge-target-same-as-source: ${source.name}`);
  await writePartitionFiles(source, target.path, target.name, true);
  await writePartitionMarker(target.path, {
    name: target.name,
    temporary,
    created_at: target.marker.created_at,
    updated_at: new Date().toISOString(),
  });
  await fs.promises.rm(source.path, { recursive: true, force: true });
  return (await getPartitionInfo(target.dir, target.name)) as PartitionInfo;
}

function sortPartitionCandidates(items: PartitionDeleteCandidate[]): PartitionDeleteCandidate[] {
  return items.sort((a, b) => a.info.name.localeCompare(b.info.name));
}

function partitionAgeReferenceMs(info: PartitionInfo): number {
  const reference = info.last_activity_at || info.updated_at || info.created_at;
  const parsed = Date.parse(reference);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cutoffMsForDays(days: number | undefined): number | null {
  const value = Number(days);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Date.now() - value * 24 * 60 * 60 * 1000;
}

async function collectPartitionDeleteCandidates(dir: string, options: DeletePartitionsOptions = {}): Promise<PartitionDeleteCandidate[]> {
  const wanted = new Set((options.partitions || []).map((item) => sanitizePartitionName(item)));
  const cutoff = cutoffMsForDays(options.olderThanDays);
  const records = await collectPartitionRecords(dir);
  const items = await Promise.all(records.map(async (record) => ({
    record,
    info: await partitionInfoFromRecord(record),
  })));

  return sortPartitionCandidates(items.filter(({ info }) => {
    if (wanted.size && !wanted.has(info.name)) return false;
    if (options.temporaryOnly === true && info.temporary !== true) return false;
    if (cutoff != null && partitionAgeReferenceMs(info) >= cutoff) return false;
    return true;
  }));
}

async function partitionMarkerMap(dir: string): Promise<Map<string, PartitionMarker>> {
  const records = await collectPartitionRecords(dir);
  return new Map(records.map((record) => [record.name, record.marker]));
}

function fileMatchesDeleteFilters(file: WalkedLogFile, options: DeleteLogsOptions): boolean {
  const level = toString(options.level || "all").toLowerCase() || "all";
  const groupKey = toString(options.groupKey || "all") || "all";
  const day = toString(options.day);
  const hour = toString(options.hour);

  if (day && file.day !== day) return false;
  if (hour && file.hour !== hour) return false;
  if (groupKey !== "all" && file.groupKey !== normGroup(groupKey).key) return false;
  if (level !== "all" && file.level !== level) return false;
  return true;
}

async function listTopLevelFiles(baseDir: string): Promise<WalkedLogFile[]> {
  const out: WalkedLogFile[] = [];
  const stack: Array<{ dir: string; rootDir: string; partition: string | null }> = [{ dir: baseDir, rootDir: baseDir, partition: null }];
  const markers = await partitionMarkerMap(baseDir);

  while (stack.length) {
    const current = stack.pop() as { dir: string; rootDir: string; partition: string | null };
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.partition == null && markers.has(entry.name)) {
          stack.push({ dir: absPath, rootDir: absPath, partition: entry.name });
          continue;
        }
        stack.push({ dir: absPath, rootDir: current.rootDir, partition: current.partition });
        continue;
      }
      if (!entry.isFile() || entry.name === PARTITION_MARKER_FILE) continue;
      const walked = walkedFileFromPath(current.rootDir, absPath, current.partition, current.rootDir);
      if (walked) out.push(walked);
    }
  }

  out.sort((a, b) => a.absPath.localeCompare(b.absPath));
  return out;
}

async function fileDeleteCandidates(dir: string, options: DeleteLogsOptions = {}): Promise<DeleteLogCandidate[]> {
  const baseDir = resolveDir(dir);
  if (!baseDir) return [];
  const markers = await partitionMarkerMap(baseDir);
  const files = await listTopLevelFiles(baseDir);
  const cutoff = cutoffMsForDays(options.olderThanDays);
  const hasExplicitPartition = Object.prototype.hasOwnProperty.call(options, "partition");
  const explicitPartition = hasExplicitPartition && options.partition != null ? sanitizePartitionName(options.partition) : options.partition;
  const acrossPartitions = options.acrossPartitions === true || !hasExplicitPartition;

  const out: DeleteLogCandidate[] = [];
  for (const file of files) {
    if (!fileMatchesDeleteFilters(file, options)) continue;
    if (!acrossPartitions) {
      if (explicitPartition == null) {
        if (file.partition != null) continue;
      } else if (file.partition !== explicitPartition) continue;
    } else if (hasExplicitPartition) {
      if (explicitPartition == null) {
        if (file.partition != null) continue;
      } else if (file.partition !== explicitPartition) continue;
    }

    if (options.temporaryOnly === true) {
      if (!file.partition) continue;
      if (markers.get(file.partition)?.temporary !== true) continue;
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(file.absPath);
    } catch {
      continue;
    }

    if (cutoff != null && stat.mtimeMs >= cutoff) continue;
    out.push({
      file,
      bytes: stat.size,
      logs: (await readLogRows(file.absPath, file.compressed)).length,
    });
  }

  return out;
}

async function createPartition(dir: string, partition: string, options: CreatePartitionOptions = {}): Promise<PartitionInfo> {
  const baseDir = resolveDir(dir);
  if (!baseDir) throw new Error("missing-log-dir");
  const name = sanitizePartitionName(partition);
  const rootDir = partitionRootPath(baseDir, name);
  if (await pathExists(rootDir)) throw new Error(`partition-already-exists: ${name}`);
  await writePartitionMarker(rootDir, {
    name,
    temporary: options.temporary === true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return (await getPartitionInfo(baseDir, name)) as PartitionInfo;
}

async function listPartitions(dir: string): Promise<PartitionInfo[]> {
  const records = await collectPartitionRecords(dir);
  const items = await Promise.all(records.map((record) => partitionInfoFromRecord(record)));
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

async function getPartitionInfo(dir: string, partition: string): Promise<PartitionInfo | null> {
  const record = await getPartitionRecord(dir, partition);
  return record ? partitionInfoFromRecord(record) : null;
}

async function renamePartition(dir: string, options: RenamePartitionOptions): Promise<PartitionInfo> {
  const source = await requirePartitionRecord(dir, options.from);
  const targetName = sanitizePartitionName(options.to);
  return transformPartition({
    source,
    targetDir: source.dir,
    targetName,
    deleteSource: true,
    targetTemporary: source.marker.temporary,
    preserveSourceCreatedAt: true,
  });
}

async function movePartition(options: MovePartitionOptions): Promise<PartitionInfo> {
  const source = await requirePartitionRecord(options.fromDir, options.from);
  const targetName = sanitizePartitionName(options.to || source.name);
  return transformPartition({
    source,
    targetDir: resolveDir(options.toDir),
    targetName,
    deleteSource: true,
    targetTemporary: source.marker.temporary,
    preserveSourceCreatedAt: true,
  });
}

async function copyPartition(options: CopyPartitionOptions): Promise<PartitionInfo> {
  const source = await requirePartitionRecord(options.fromDir, options.from);
  const targetDir = resolveDir(options.toDir);
  const targetName = sanitizePartitionName(options.to || source.name);
  if (source.dir === targetDir && source.name === targetName) throw new Error(`partition-already-exists: ${targetName}`);
  return transformPartition({
    source,
    targetDir,
    targetName,
    deleteSource: false,
    targetTemporary: source.marker.temporary,
    preserveSourceCreatedAt: false,
  });
}

async function mergePartition(dir: string, options: MergePartitionOptions): Promise<PartitionInfo> {
  const source = await requirePartitionRecord(dir, options.from);
  const target = await requirePartitionRecord(dir, options.to);
  return mergePartitionRecord(source, target, target.marker.temporary);
}

async function deletePartition(dir: string, partition: string): Promise<DeletePartitionResult> {
  return deletePartitions(dir, { partitions: [partition] });
}

async function deletePartitions(dir: string, options: DeletePartitionsOptions = {}): Promise<DeletePartitionResult> {
  const candidates = await collectPartitionDeleteCandidates(dir, options);
  let files = 0;
  let logs = 0;
  let bytes = 0;

  for (const item of candidates) {
    files += item.info.total.files;
    logs += item.info.total.logs;
    bytes += item.info.total.bytes;
    await fs.promises.rm(item.record.path, { recursive: true, force: true });
  }

  return {
    partitions: candidates.length,
    files,
    logs,
    bytes,
    items: candidates.map((item) => item.info.name),
  };
}

async function deleteLogs(dir: string, options: DeleteLogsOptions = {}): Promise<DeleteLogsResult> {
  const candidates = await fileDeleteCandidates(dir, options);
  const partitions = new Set<string>();

  for (const item of candidates) {
    if (item.file.partition) partitions.add(item.file.partition);
    await fs.promises.rm(item.file.absPath, { force: true });
  }

  return {
    partitions: partitions.size,
    files: candidates.length,
    logs: candidates.reduce((sum, item) => sum + item.logs, 0),
    bytes: candidates.reduce((sum, item) => sum + item.bytes, 0),
    items: candidates.map((item) => ({
      path: item.file.absPath,
      partition: item.file.partition,
      logs: item.logs,
      bytes: item.bytes,
    })),
  };
}

export {
  createPartition,
  copyPartition,
  deleteLogs,
  deletePartition,
  deletePartitions,
  getPartitionInfo,
  listPartitions,
  mergePartition,
  movePartition,
  readPartitionMarkerFromRoot,
  readPartitionMarkerFromRootSync,
  renamePartition,
  touchPartitionMarker,
  touchPartitionMarkerSync,
};
