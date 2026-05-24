import type { ExportFormat } from "../../types.js";

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
  };
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

type StorageBackend = {
  name: StorageBackendName;
  scanPartitions(dir: string, partitions: string[]): Promise<StorageScanSnapshot>;
  createArchive(input: ArchiveCreateInput): Promise<void>;
};

export type {
  ArchiveCreateInput,
  ArchiveGeneratedFile,
  ArchiveSourceFile,
  StorageBackend,
  StorageBackendName,
  StorageScanFile,
  StorageScanPartition,
  StorageScanSnapshot,
};
