import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type {
  ArchiveCreateInput,
  StorageBackend,
  StorageCleanupRequest,
  StorageQueryRequest,
  StorageQueryResponse,
  StorageScanSnapshot,
} from "./types.js";

type NativeBinding = {
  scanPartitions(dir: string, partitions: string[]): string;
  rewritePartitionFiles(requestJson: string): void;
  createArchive(requestJson: string): void;
  queryLogs ? (requestJson: string) : string;
  queryLogsAsync ? (requestJson: string) : Promise<string>;
  cleanupLogs ? (requestJson: string) : void;
  cleanupLogsAsync ? (requestJson: string) : Promise<void>;
};

let cachedBinding: NativeBinding | null | undefined;

function linuxLibcVariant(): "gnu" | "musl" {
  const report = typeof process.report?.getReport === "function" ? process.report.getReport() : null;
  const header = report && typeof report === "object" ? (report as { header?: { glibcVersionRuntime?: string } }).header : null;
  if (header?.glibcVersionRuntime) return "gnu";
  if (fs.existsSync("/etc/alpine-release")) return "musl";
  return "gnu";
}

function nativeBinaryBasenameForCurrentPlatform(): string | null {
  if (process.platform === "linux") {
    const libc = linuxLibcVariant();
    if (process.arch === "x64") return `linux-x64-${libc}.node`;
    if (process.arch === "arm64") return `linux-arm64-${libc}.node`;
    return null;
  }
  if (process.platform === "darwin") {
    if (process.arch === "x64") return "darwin-x64.node";
    if (process.arch === "arm64") return "darwin-arm64.node";
    return null;
  }
  return null;
}

function nativeAddonCandidatePathsForCurrentPlatform(): string[] {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const binaryName = nativeBinaryBasenameForCurrentPlatform();
  const envOverride = process.env.TB_LOGGER_NATIVE_BINARY
  ? path.resolve(process.env.TB_LOGGER_NATIVE_BINARY)
  : "";

  return [
    envOverride,
    binaryName ? path.resolve(currentDir, "../../../native", binaryName) : "",
    binaryName ? path.resolve(process.cwd(), "native", binaryName) : "",
    path.resolve(currentDir, "../../../native/index.node"),
    path.resolve(process.cwd(), "native/index.node"),
    path.resolve(currentDir, "../../../native/logger-native/index.node"),
    path.resolve(process.cwd(), "native/logger-native/index.node"),
  ].filter(Boolean);
}

function loadBinding(): NativeBinding | null {
  if (cachedBinding !== undefined) return cachedBinding;
  if (process.env.TB_LOGGER_DISABLE_NATIVE === "1") {
    cachedBinding = null;
    return cachedBinding;
  }

  const require = createRequire(import.meta.url);
  const candidates = nativeAddonCandidatePathsForCurrentPlatform();

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      cachedBinding = require(candidate) as NativeBinding;
      return cachedBinding;
    } catch {}
  }

  cachedBinding = null;
  return cachedBinding;
}

function resetNativeBindingForTests(): void {
  cachedBinding = undefined;
}

function nativeStorageBackend(): StorageBackend | null {
  const binding = loadBinding();
  if (!binding) return null;

  const backend: StorageBackend = {
    name: "native",
    async scanPartitions(dir: string, partitions: string[]): Promise<StorageScanSnapshot> {
      return JSON.parse(binding.scanPartitions(dir, partitions)) as StorageScanSnapshot;
    },
    async rewritePartitionFiles(input): Promise<void> {
      binding.rewritePartitionFiles(JSON.stringify(input));
    },
    async createArchive(input: ArchiveCreateInput): Promise<void> {
      binding.createArchive(JSON.stringify(input));
    },
  };

  if (typeof binding.queryLogsAsync === "function") {
    backend.queryLogs = async(request: StorageQueryRequest): Promise<StorageQueryResponse> => {
      return JSON.parse(await binding.queryLogsAsync!(JSON.stringify(request))) as StorageQueryResponse;
    };
  } else if (typeof binding.queryLogs === "function") {
    backend.queryLogs = async(request: StorageQueryRequest): Promise<StorageQueryResponse> => {
      return JSON.parse(binding.queryLogs!(JSON.stringify(request))) as StorageQueryResponse;
    };
  }

  if (typeof binding.cleanupLogsAsync === "function") {
    backend.cleanupLogs = async(request: StorageCleanupRequest): Promise<void> => {
      await binding.cleanupLogsAsync!(JSON.stringify(request));
    };
  } else if (typeof binding.cleanupLogs === "function") {
    backend.cleanupLogs = async(request: StorageCleanupRequest): Promise<void> => {
      binding.cleanupLogs!(JSON.stringify(request));
    };
  }

  return backend;
}

export {
  nativeAddonCandidatePathsForCurrentPlatform,
  nativeBinaryBasenameForCurrentPlatform,
  nativeStorageBackend,
  resetNativeBindingForTests,
};
