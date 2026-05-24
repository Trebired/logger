import type { PartitionTotals } from "./partitions.js";

type ExportFormat = "tar.gz" | "zip";

type ExportCommonOptions = {
  outputPath: string;
  format?: ExportFormat;
  overwrite?: boolean;
};

type ExportPartitionOptions = ExportCommonOptions;

type ExportPartitionsOptions = ExportCommonOptions & {
  partitions?: string[];
};

type ExportManifestFile = {
  path: string;
  partition: string;
  groupKey: string;
  day: string;
  hour: string;
  level: string;
  compressed: boolean;
  bytes: number;
  rows: number;
};

type ExportManifestPartition = {
  name: string;
  total: PartitionTotals;
  last_activity_at: string | null;
};

type ExportManifest = {
  version: 1;
  generated_at: string;
  dir: string;
  partitions: string[];
  partition_items: ExportManifestPartition[];
  total: {
    partitions: number;
    files: number;
    logs: number;
    bytes: number;
  };
  files: ExportManifestFile[];
};

type ExportResult = {
  path: string;
  format: ExportFormat;
  backend: "native" | "js";
  partitions: string[];
  files: number;
  logs: number;
  bytes: number;
  manifest: ExportManifest;
};

export type {
  ExportFormat,
  ExportManifest,
  ExportManifestFile,
  ExportManifestPartition,
  ExportPartitionOptions,
  ExportPartitionsOptions,
  ExportResult,
};
