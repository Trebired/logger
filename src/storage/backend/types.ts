import type { ExportFormat } from "#e1h3ay0cyhgl";

type StorageBackendName = "native" | "js";

type StorageScanFile = {
  absPath: string;
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

type StorageScanPartition = {
  name: string;
  total: {
    logs: number;
    dirs: number;
    files: number;
    bytes: number;
    megabytes: number;
  };
  lastActivityAt: string | null;
};

type StorageScanSnapshot = {
  partitions: StorageScanPartition[];
  files: StorageScanFile[];
  total: {
    partitions: number;
    files: number;
    logs: number;
    bytes: number;
    megabytes: number;
  };
};

type PartitionRewriteInput = {
  sourceRoot: string;
  targetRoot: string;
  targetName: string;
  merge: boolean;
};

type ArchiveGeneratedFile = {
  archivePath: string;
  content: string;
};

type ArchiveSourceFile = {
  sourcePath: string;
  archivePath: string;
};

type ArchiveCreateInput = {
  outputPath: string;
  format: ExportFormat;
  rootName: string;
  overwrite: boolean;
  generatedFiles: ArchiveGeneratedFile[];
  sourceFiles: ArchiveSourceFile[];
};

type StorageQueryRequest = {
  dir: string;
  partition: string | null;
  acrossPartitions: boolean;
  level: string;
  groupKey: string;
  day: string;
  hour: string;
  limit: number;
  totals: boolean;
};

type StorageQueryTotals = {
  logs: number;
  dirs: number;
  files: number;
};

type StorageQueryPartitionItem = {
  partition: string | null;
  count: number;
  total: StorageQueryTotals;
};

type StorageQueryResponse = {
  logs: Record<string, unknown>[];
  items: StorageQueryPartitionItem[];
  scope: StorageQueryTotals;
};

type StorageCleanupRequest = {
  dir: string;
  maxAgeDays: number | null;
  compressOldFiles: boolean;
  maxPartitions: number | null;
  nowDay: string;
  nowHour: string;
};

type StorageBackend = {
  name: StorageBackendName;
  scanPartitions(dir: string, partitions: string[]): Promise<StorageScanSnapshot>;
  rewritePartitionFiles(input: PartitionRewriteInput): Promise<void>;
  createArchive(input: ArchiveCreateInput): Promise<void>;
  queryLogs ? (request: StorageQueryRequest) : Promise<StorageQueryResponse>;
  cleanupLogs ? (request: StorageCleanupRequest) : Promise<void>;
};

export type {
  ArchiveCreateInput,
  StorageCleanupRequest,
  StorageQueryPartitionItem,
  StorageQueryRequest,
  StorageQueryResponse,
  StorageQueryTotals,
  ArchiveGeneratedFile,
  ArchiveSourceFile,
  PartitionRewriteInput,
  StorageBackend,
  StorageBackendName,
  StorageScanFile,
  StorageScanPartition,
  StorageScanSnapshot,
};
