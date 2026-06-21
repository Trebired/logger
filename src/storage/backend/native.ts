import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { ArchiveCreateInput, StorageBackend, StorageScanSnapshot } from "./types.js";
import type { ResolvedConsoleVisibilityPayload } from "#jp65xdmizety";

type NativeBinding = {
  scanPartitions(dir: string, partitions: string[]): string;
  rewritePartitionFiles(requestJson: string): void;
  createArchive(requestJson: string): void;
  resolveConsoleVisibilityConfig(startDir: string): string;
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

  return {
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
}

function resolveNativeConsoleVisibilityConfig(startDir: string): ResolvedConsoleVisibilityPayload | null {
  const binding = loadBinding();
  if (!binding || typeof binding.resolveConsoleVisibilityConfig !== "function") return null;
  return JSON.parse(binding.resolveConsoleVisibilityConfig(startDir)) as ResolvedConsoleVisibilityPayload;
}

export {
  nativeAddonCandidatePathsForCurrentPlatform,
  nativeBinaryBasenameForCurrentPlatform,
  nativeStorageBackend,
  resolveNativeConsoleVisibilityConfig,
  resetNativeBindingForTests,
};
