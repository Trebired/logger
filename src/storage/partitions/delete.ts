import fs from "node:fs";

import type { DeleteLogsOptions, DeleteLogsResult, DeletePartitionResult, DeletePartitionsOptions } from "#tvzweoxg5ahk";
import { sanitizePartitionName } from "#x2qkmwodgsce";
import { fileMatchesDeleteFilters, listTopLevelFiles, readLogRows } from "./files.js";
import { collectPartitionRecords, partitionInfoFromRecord, partitionMarkerMap } from "./records.js";
import { cutoffMsForDays, partitionAgeReferenceMs, resolveDir, type DeleteLogCandidate, type PartitionDeleteCandidate } from "./internal.js";

function sortPartitionCandidates(items: PartitionDeleteCandidate[]): PartitionDeleteCandidate[] {
  return items.sort((a, b) => a.info.name.localeCompare(b.info.name));
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

async function deleteNonCurrentTemporaryPartitions(dir: string, currentPartitions: string[] = []): Promise<string[]> {
  const keep = new Set(currentPartitions.map((partition) => sanitizePartitionName(partition)));
  const records = await collectPartitionRecords(dir);
  const stale = records.filter((record) => record.marker.temporary === true && !keep.has(record.name));

  for (const record of stale) {
    await fs.promises.rm(record.path, { recursive: true, force: true });
  }

  return stale.map((record) => record.name).sort((a, b) => a.localeCompare(b));
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

export { deleteLogs, deleteNonCurrentTemporaryPartitions, deletePartitions };
