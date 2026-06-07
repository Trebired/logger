import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createLog, createPartition, exportPartition, exportPartitions } from "../../src/index";
import { setStorageBackendPreferenceForTests } from "../../src/storage/backend/index";
import { canBuildNativeAddon, readArchiveEntries, tempDir, writePartitionLogFile } from "./helpers";

function archiveRootName(filePath: string): string {
  const base = path.basename(filePath);
  if (base.endsWith(".tar.gz")) return base.slice(0, -7);
  if (base.endsWith(".zip")) return base.slice(0, -4);
  return base;
}

async function manifestFromArchive(filePath: string): Promise<any> {
  const entries = await readArchiveEntries(filePath);
  const manifestPath = `${archiveRootName(filePath)}/manifest.json`;
  return JSON.parse((entries.get(manifestPath) || Buffer.from("{}")).toString("utf8"));
}

describe("partition export", () => {
  test("exports a single partition to tar.gz with manifest metadata and preserved bytes", async () => {
    const dir = tempDir("export_test_");
    await createPartition(dir, "alpha");
    await createPartition(dir, "beta");

    writePartitionLogFile(dir, "alpha", "jobs.queue", "2026-05-17-10-00-00-0000-info.jsonl", [{
      recorded_at: "2026-05-17T10:00:00.000Z",
      level: "info",
      group: "jobs.queue",
      message: "alpha-info",
      origin: { source: "test", instance: null },
      partition: "alpha",
    }]);
    writePartitionLogFile(dir, "alpha", "jobs.queue", "2026-05-17-11-00-00-0000-warn.jsonl", [{
      recorded_at: "2026-05-17T11:00:00.000Z",
      level: "warn",
      group: "jobs.queue",
      message: "alpha-warn",
      origin: { source: "test", instance: null },
      partition: "alpha",
    }], true);
    writePartitionLogFile(dir, "beta", "ops.audit", "2026-05-17-10-00-00-0000-info.jsonl", [{
      recorded_at: "2026-05-17T10:00:00.000Z",
      level: "info",
      group: "ops.audit",
      message: "beta-info",
      origin: { source: "test", instance: null },
      partition: "beta",
    }]);

    const result = await exportPartition(dir, "alpha", {
      outputPath: path.join(dir, "alpha-export"),
    });

    expect(result.path.endsWith(".tar.gz")).toBe(true);
    expect(result.partitions).toEqual(["alpha"]);
    const root = archiveRootName(result.path);
    const entries = await readArchiveEntries(result.path);
    const manifest = JSON.parse((entries.get(`${root}/manifest.json`) as Buffer).toString("utf8"));

    expect(entries.has(`${root}/logs/alpha/jobs/queue/2026-05-17-10-00-00-0000-info.jsonl`)).toBe(true);
    expect(entries.has(`${root}/logs/alpha/jobs/queue/2026-05-17-11-00-00-0000-warn.jsonl.gz`)).toBe(true);
    expect(entries.has(`${root}/logs/beta/ops/audit/2026-05-17-10-00-00-0000-info.jsonl`)).toBe(false);
    expect(manifest.partitions).toEqual(["alpha"]);
    expect(manifest.total.files).toBe(2);
    expect(manifest.total.logs).toBe(2);

    const sourceGzip = fs.readFileSync(path.join(dir, "alpha", "jobs", "queue", "2026-05-17-11-00-00-0000-warn.jsonl.gz"));
    expect(entries.get(`${root}/logs/alpha/jobs/queue/2026-05-17-11-00-00-0000-warn.jsonl.gz`)).toEqual(sourceGzip);
  });

  test("exports multiple partitions to zip with raw files for each selected partition", async () => {
    const dir = tempDir("export_test_");
    await createPartition(dir, "alpha");
    await createPartition(dir, "beta");

    writePartitionLogFile(dir, "alpha", "jobs.queue", "2026-05-17-10-00-00-0000-info.jsonl", [{
      recorded_at: "2026-05-17T10:00:00.000Z",
      level: "info",
      group: "jobs.queue",
      message: "alpha-info",
      origin: { source: "test", instance: null },
      partition: "alpha",
    }]);
    writePartitionLogFile(dir, "beta", "ops.audit", "2026-05-17-10-01-00-0000-error.jsonl", [{
      recorded_at: "2026-05-17T10:01:00.000Z",
      level: "error",
      group: "ops.audit",
      message: "beta-error",
      origin: { source: "test", instance: null },
      partition: "beta",
    }]);

    const result = await exportPartitions(dir, {
      outputPath: path.join(dir, "bundle.zip"),
      format: "zip",
      partitions: ["beta", "alpha"],
    });

    const root = archiveRootName(result.path);
    const entries = await readArchiveEntries(result.path);
    const manifest = JSON.parse((entries.get(`${root}/manifest.json`) as Buffer).toString("utf8"));

    expect(manifest.partitions).toEqual(["alpha", "beta"]);
    expect(entries.has(`${root}/logs/alpha/jobs/queue/2026-05-17-10-00-00-0000-info.jsonl`)).toBe(true);
    expect(entries.has(`${root}/logs/beta/ops/audit/2026-05-17-10-01-00-0000-error.jsonl`)).toBe(true);
  });

  test("logger instance export flushes pending writes and can export all partitions from the logger dir", async () => {
    const dir = tempDir("export_test_");
    const alpha = createLog({ dir, partition: "alpha", console: false, quiet: true });
    const beta = createLog({ dir, partition: "beta", console: false, quiet: true });

    alpha.info("jobs.queue", "alpha-pending");
    beta.warn("jobs.queue", "beta-pending");

    const single = await alpha.exportPartition(undefined, {
      outputPath: path.join(dir, "active-alpha.tar.gz"),
    });
    const singleManifest = await manifestFromArchive(single.path);
    expect(singleManifest.partitions).toEqual(["alpha"]);
    expect(singleManifest.total.logs).toBe(1);

    const all = await alpha.exportPartitions({
      outputPath: path.join(dir, "all-partitions.zip"),
      format: "zip",
    });
    const allManifest = await manifestFromArchive(all.path);
    expect(allManifest.partitions).toEqual(["alpha", "beta"]);
    expect(allManifest.total.logs).toBe(2);

    await alpha.close();
    await beta.close();
  });

  test("rejects output extension mismatches and existing targets without overwrite", async () => {
    const dir = tempDir("export_test_");
    await createPartition(dir, "alpha");
    writePartitionLogFile(dir, "alpha", "jobs.queue", "2026-05-17-10-00-00-0000-info.jsonl", [{
      recorded_at: "2026-05-17T10:00:00.000Z",
      level: "info",
      group: "jobs.queue",
      message: "alpha-info",
      origin: { source: "test", instance: null },
      partition: "alpha",
    }]);

    await expect(exportPartition(dir, "alpha", {
      outputPath: path.join(dir, "bad.zip"),
      format: "tar.gz",
    })).rejects.toThrow("export-format-output-extension-mismatch");

    const target = path.join(dir, "existing.zip");
    fs.writeFileSync(target, "x", "utf8");
    await expect(exportPartition(dir, "alpha", {
      outputPath: target,
      format: "zip",
    })).rejects.toThrow("export-output-already-exists");
  });

  test("js and native backends emit the same manifest and archive member paths when native is available", async () => {
    if (typeof Bun !== "undefined") return;
    if (!canBuildNativeAddon()) return;

    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const built = spawnSync("bun", ["run", "build:native"], {
      cwd: repoRoot,
      stdio: "pipe",
      encoding: "utf8",
    });
    if (built.status !== 0) return;

    const dir = tempDir("export_test_");
    await createPartition(dir, "alpha");
    await createPartition(dir, "beta");
    writePartitionLogFile(dir, "alpha", "jobs.queue", "2026-05-17-10-00-00-0000-info.jsonl", [{
      recorded_at: "2026-05-17T10:00:00.000Z",
      level: "info",
      group: "jobs.queue",
      message: "alpha-info",
      origin: { source: "test", instance: null },
      partition: "alpha",
    }]);
    writePartitionLogFile(dir, "beta", "ops.audit", "2026-05-17-10-01-00-0000-error.jsonl", [{
      recorded_at: "2026-05-17T10:01:00.000Z",
      level: "error",
      group: "ops.audit",
      message: "beta-error",
      origin: { source: "test", instance: null },
      partition: "beta",
    }], true);

    try {
      setStorageBackendPreferenceForTests("js");
      const jsResult = await exportPartitions(dir, {
        outputPath: path.join(dir, "js-export.zip"),
        format: "zip",
      });
      setStorageBackendPreferenceForTests("native");
      const nativeResult = await exportPartitions(dir, {
        outputPath: path.join(dir, "native-export.zip"),
        format: "zip",
      });

      const jsEntries = await readArchiveEntries(jsResult.path);
      const nativeEntries = await readArchiveEntries(nativeResult.path);
      const jsNames = Array.from(jsEntries.keys()).sort();
      const nativeNames = Array.from(nativeEntries.keys()).sort();
      expect(jsNames).toEqual(nativeNames);
      expect(JSON.parse((jsEntries.get(`${archiveRootName(jsResult.path)}/manifest.json`) as Buffer).toString("utf8")))
        .toEqual(JSON.parse((nativeEntries.get(`${archiveRootName(nativeResult.path)}/manifest.json`) as Buffer).toString("utf8")));
    } finally {
      setStorageBackendPreferenceForTests(null);
    }
  });
});
