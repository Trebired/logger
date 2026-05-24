import fs from "node:fs";
import path from "node:path";

import type { ExportFormat, ExportManifest, ExportPartitionOptions, ExportPartitionsOptions, ExportResult } from "../types.js";
import { toString } from "../utils/values.js";
import { getStorageBackend } from "./backend/index.js";
import { collectPartitionRecords } from "./partitions/records.js";
import { resolveDir } from "./partitions/internal.js";
import { sanitizePartitionName } from "./names.js";

type NormalizedExportOptions = {
  outputPath: string;
  format: ExportFormat;
  overwrite: boolean;
  rootName: string;
};

function normalizeFormat(input: unknown): ExportFormat {
  return input === "zip" ? "zip" : "tar.gz";
}

function stripArchiveExtension(fileName: string): string {
  if (fileName.endsWith(".tar.gz")) return fileName.slice(0, -7);
  if (fileName.endsWith(".zip")) return fileName.slice(0, -4);
  return fileName;
}

function normalizeOutputPath(options: ExportPartitionOptions | ExportPartitionsOptions): NormalizedExportOptions {
  const rawOutputPath = toString(options.outputPath).trim();
  if (!rawOutputPath) throw new Error("missing-export-output-path");
  const format = normalizeFormat(options.format);
  let outputPath = path.resolve(rawOutputPath);

  if (!outputPath.endsWith(".tar.gz") && !outputPath.endsWith(".zip")) {
    outputPath = `${outputPath}${format === "zip" ? ".zip" : ".tar.gz"}`;
  }

  if (format === "zip" && !outputPath.endsWith(".zip")) throw new Error("export-format-output-extension-mismatch");
  if (format === "tar.gz" && !outputPath.endsWith(".tar.gz")) throw new Error("export-format-output-extension-mismatch");

  return {
    outputPath,
    format,
    overwrite: options.overwrite === true,
    rootName: stripArchiveExtension(path.basename(outputPath)),
  };
}

function buildManifest(dir: string, snapshot: Awaited<ReturnType<ReturnType<typeof getStorageBackend>["scanPartitions"]>>): ExportManifest {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    dir,
    partitions: snapshot.partitions.map((item) => item.name),
    partition_items: snapshot.partitions.map((item) => ({
      name: item.name,
      total: item.total,
      last_activity_at: item.lastActivityAt,
    })),
    total: snapshot.total,
    files: snapshot.files.map((file) => ({
      path: file.path,
      partition: file.partition,
      groupKey: file.groupKey,
      day: file.day,
      hour: file.hour,
      level: file.level,
      compressed: file.compressed,
      bytes: file.bytes,
      rows: file.rows,
    })),
  };
}

async function resolvePartitions(dir: string, options?: ExportPartitionsOptions): Promise<string[]> {
  const records = await collectPartitionRecords(dir);
  const allNames = records.map((item) => item.name).sort((a, b) => a.localeCompare(b));
  if (!(options && Object.prototype.hasOwnProperty.call(options, "partitions"))) return allNames;

  const requested = Array.from(new Set((options?.partitions || []).map((item) => sanitizePartitionName(item))));
  if (!requested.length) throw new Error("export-partitions-empty");
  for (const name of requested) {
    if (!allNames.includes(name)) throw new Error(`partition-not-found: ${name}`);
  }
  return requested.sort((a, b) => a.localeCompare(b));
}

async function exportPartitions(dir: string, options: ExportPartitionsOptions): Promise<ExportResult> {
  const baseDir = resolveDir(dir);
  if (!baseDir) throw new Error("missing-log-dir");
  const normalized = normalizeOutputPath(options);
  const partitions = await resolvePartitions(baseDir, options);
  const backend = getStorageBackend();
  const snapshot = await backend.scanPartitions(baseDir, partitions);
  const manifest = buildManifest(baseDir, snapshot);

  if (fs.existsSync(normalized.outputPath) && !normalized.overwrite) {
    throw new Error(`export-output-already-exists: ${normalized.outputPath}`);
  }

  const generatedFiles = [
    {
      archivePath: "manifest.json",
      content: `${JSON.stringify(manifest, null, 2)}\n`,
    },
  ];

  await backend.createArchive({
    outputPath: normalized.outputPath,
    format: normalized.format,
    rootName: normalized.rootName,
    overwrite: normalized.overwrite,
    generatedFiles,
    sourceFiles: snapshot.files.map((file) => ({
      sourcePath: file.absPath,
      archivePath: path.posix.join("logs", file.path),
    })),
  });

  return {
    path: normalized.outputPath,
    format: normalized.format,
    backend: backend.name,
    partitions: manifest.partitions,
    files: manifest.total.files,
    logs: manifest.total.logs,
    bytes: manifest.total.bytes,
    manifest,
  };
}

async function exportPartition(dir: string, partition: string, options: ExportPartitionOptions): Promise<ExportResult> {
  return exportPartitions(dir, {
    ...options,
    partitions: [sanitizePartitionName(partition)],
  });
}

export { exportPartition, exportPartitions };
