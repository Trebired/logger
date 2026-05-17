import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import {
  buildPartitionName,
  buildTemporaryPartitionName,
  copyPartition,
  createLog,
  createPartition,
  deleteLogs,
  deletePartition,
  deletePartitions,
  formatPartitionTimePrefix,
  getLogsForDir,
  getPartitionInfo,
  listPartitions,
  mergePartition,
  movePartition,
  renamePartition,
  sanitizePartitionName,
} from "../src/index";

function tempDir(): string {
  const parent = path.join(os.tmpdir(), "@trebired-logger");
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, "partition_test_"));
}

function forceRecordedAt(value: string): Record<string, unknown> {
  return { __recorded_at: value };
}

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop() || "";
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else out.push(abs);
    }
  }
  return out.sort();
}

function partitionMarkerPath(dir: string, partition: string): string {
  return path.join(dir, partition, ".trebired-partition.json");
}

function readPartitionMarker(dir: string, partition: string) {
  return JSON.parse(fs.readFileSync(partitionMarkerPath(dir, partition), "utf8"));
}

function writePartitionMarker(dir: string, partition: string, marker: Record<string, unknown>): void {
  fs.writeFileSync(partitionMarkerPath(dir, partition), `${JSON.stringify(marker)}\n`, "utf8");
}

function groupDir(rootDir: string, groupKey: string): string {
  const parts = groupKey.split(".").map((part) => part.replace(/[^a-zA-Z0-9_-]/g, "-")).filter(Boolean);
  const safeParts = parts.length ? parts : ["top-level"];
  return path.join(rootDir, ...safeParts);
}

function writePartitionLogFile(
  dir: string,
  partition: string,
  groupKey: string,
  fileName: string,
  rows: Array<Record<string, unknown>>,
  compressed = false,
): void {
  const root = path.join(dir, partition);
  const targetDir = groupDir(root, groupKey);
  fs.mkdirSync(targetDir, { recursive: true });
  const payload = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  const targetPath = path.join(targetDir, compressed ? `${fileName}.gz` : fileName);
  if (compressed) {
    fs.writeFileSync(targetPath, zlib.gzipSync(Buffer.from(payload, "utf8")));
    return;
  }
  fs.writeFileSync(targetPath, payload, "utf8");
}

describe("partition lifecycle", () => {
  test("builds time-prefixed partition names and sanitizes caller suffixes", () => {
    expect(formatPartitionTimePrefix({
      at: "2026-05-17T10:34:00.000Z",
      timeZone: "Europe/Prague",
    })).toBe("2026-05-17-12-0000");

    expect(buildPartitionName({
      at: "2026-05-17T10:34:00.000Z",
      timeZone: "Europe/Prague",
      suffix: "deploy 42/blue",
    })).toBe("2026-05-17-12-0000-deploy-42-blue");

    expect(buildPartitionName({
      at: "2026-05-17T10:34:00.000Z",
      timeZone: "Europe/Prague",
      suffix: "Blue Env",
      sanitizeSuffix: (value) => value.toUpperCase().replace(/\s+/g, "_"),
    })).toBe("2026-05-17-12-0000-BLUE_ENV");

    expect(buildTemporaryPartitionName({
      at: "2026-05-17T10:34:00.000Z",
      timeZone: "Europe/Prague",
      suffix: "job 1",
    })).toMatch(/^2026-05-17-12-0000-job-1-tmp-[a-f0-9]{8}$/);

    expect(sanitizePartitionName(" any / custom+string ")).toBe("any-custom-string");
    expect(() => sanitizePartitionName("!!!")).toThrow("invalid-partition-name");
  });

  test("creates and lists temporary partitions before logs exist", async () => {
    const dir = tempDir();
    const created = await createPartition(dir, "staged-part", { temporary: true });

    expect(created.name).toBe("staged-part");
    expect(created.temporary).toBe(true);
    expect(created.total).toEqual({ logs: 0, dirs: 0, files: 0, bytes: 0 });

    const listed = await listPartitions(dir);
    expect(listed.map((item) => item.name)).toEqual(["staged-part"]);
    expect(listed[0].temporary).toBe(true);

    const info = await getPartitionInfo(dir, "staged-part");
    expect(info?.name).toBe("staged-part");
    expect(info?.last_activity_at).toBe(null);
  });

  test("supports live partition switching and explicit unpartitioned queries", async () => {
    const dir = tempDir();
    const log = createLog({ dir, partition: "alpha", console: false, quiet: true });
    const worker = log.group("jobs.queue");

    worker.info("alpha-1");
    await log.flush();

    await log.setPartition("beta", { temporary: true });
    worker.warn("beta-1");
    await log.flush();

    await log.setPartition(null);
    worker.error("root-1");
    await log.flush();

    expect(log.getPartition()).toBe(null);

    const alpha = await getLogsForDir(dir, { partition: "alpha", groupKey: "jobs.queue", limit: 10 });
    const beta = await getLogsForDir(dir, { partition: "beta", groupKey: "jobs.queue", limit: 10 });
    const root = await getLogsForDir(dir, { partition: null, groupKey: "jobs.queue", limit: 10 });
    const all = await log.getAllLogs({ groupKey: "jobs.queue", limit: 10 });

    expect(alpha.logs.map((row) => row.message)).toEqual(["alpha-1"]);
    expect(beta.logs.map((row) => row.message)).toEqual(["beta-1"]);
    expect(beta.logs[0].partition).toBe("beta");
    expect(root.logs.map((row) => row.message)).toEqual(["root-1"]);
    expect(all.logs.map((row) => row.message)).toEqual(["alpha-1", "beta-1", "root-1"]);

    const betaInfo = await log.getPartitionInfo("beta");
    expect(betaInfo?.temporary).toBe(true);

    await log.close();
  });

  test("promotes temporary partitions and keeps child loggers on the final partition", async () => {
    const dir = tempDir();
    const tempPartition = buildTemporaryPartitionName({
      at: "2026-05-17T10:00:00.000Z",
      timeZone: "UTC",
      suffix: "deployment 1",
    });
    const finalPartition = "2026-05-17-10-0000-final";
    const log = createLog({
      dir,
      partition: tempPartition,
      temporaryPartition: true,
      console: false,
      quiet: true,
    });
    const jobs = log.group("app.boot");

    jobs.info("before");
    await log.flush();

    await log.promotePartition(finalPartition);

    jobs.info("after");
    await log.flush();

    const partitions = await listPartitions(dir);
    const scoped = await getLogsForDir(dir, { partition: finalPartition, groupKey: "app.boot", limit: 10 });

    expect(partitions.map((item) => item.name)).toEqual([finalPartition]);
    expect(partitions[0].temporary).toBe(false);
    expect(fs.existsSync(path.join(dir, tempPartition))).toBe(false);
    expect(scoped.logs.map((row) => row.message)).toEqual(["before", "after"]);
    expect(scoped.logs.every((row) => row.partition === finalPartition)).toBe(true);

    await log.close();
  });

  test("merges promoted partitions into an existing final partition only when requested", async () => {
    const dir = tempDir();
    const finalLog = createLog({ dir, partition: "final", console: false, quiet: true });
    const tempLog = createLog({ dir, partition: "temp", temporaryPartition: true, console: false, quiet: true });

    finalLog.info("jobs.merge", "final-before", forceRecordedAt("2026-05-17T10:00:00.000Z"));
    tempLog.info("jobs.merge", "temp-before", forceRecordedAt("2026-05-17T10:05:00.000Z"));
    await finalLog.flush();
    await tempLog.flush();

    await tempLog.promotePartition("final", { merge: true });
    tempLog.info("jobs.merge", "temp-after", forceRecordedAt("2026-05-17T10:10:00.000Z"));
    await tempLog.flush();

    const final = await getLogsForDir(dir, { partition: "final", groupKey: "jobs.merge", limit: 10 });
    const partitions = await listPartitions(dir);

    expect(tempLog.getPartition()).toBe("final");
    expect(final.logs.map((row) => row.message)).toEqual(["final-before", "temp-before", "temp-after"]);
    expect(final.logs.every((row) => row.partition === "final")).toBe(true);
    expect(partitions.map((item) => item.name)).toEqual(["final"]);
    expect(partitions[0].temporary).toBe(false);

    await finalLog.close();
    await tempLog.close();
  });

  test("copies, renames, and moves partitions while rewriting stored row partition metadata", async () => {
    const firstDir = tempDir();
    const secondDir = tempDir();
    const log = createLog({ dir: firstDir, partition: "alpha", console: false, quiet: true });

    log.info("ops.test", "alpha");
    await log.flush();
    await log.close();

    await copyPartition({ fromDir: firstDir, from: "alpha", toDir: firstDir, to: "alpha-copy" });
    await renamePartition(firstDir, { from: "alpha-copy", to: "alpha-renamed" });
    await movePartition({ fromDir: firstDir, from: "alpha-renamed", toDir: secondDir, to: "alpha-moved" });

    const copied = await getLogsForDir(firstDir, { partition: "alpha", groupKey: "ops.test", limit: 10 });
    const moved = await getLogsForDir(secondDir, { partition: "alpha-moved", groupKey: "ops.test", limit: 10 });

    expect(copied.logs[0].partition).toBe("alpha");
    expect(moved.logs[0].partition).toBe("alpha-moved");
    expect(fs.existsSync(path.join(firstDir, "alpha-copy"))).toBe(false);
    expect(fs.existsSync(path.join(firstDir, "alpha-renamed"))).toBe(false);
    expect(fs.existsSync(path.join(secondDir, "alpha-moved"))).toBe(true);
  });

  test("merges partitions with sequence collision handling and preserves gzip files", async () => {
    const dir = tempDir();
    const fileName = "2026-05-17-10-0000-info.jsonl";
    await createPartition(dir, "target");
    await createPartition(dir, "source");

    writePartitionLogFile(dir, "target", "merge.collision", fileName, [{
      recorded_at: "2026-05-17T10:00:00.000Z",
      level: "info",
      group: "merge.collision",
      message: "target",
      origin: { source: "test", instance: null },
      partition: "target",
    }]);

    writePartitionLogFile(dir, "source", "merge.collision", fileName, [{
      recorded_at: "2026-05-17T10:05:00.000Z",
      level: "info",
      group: "merge.collision",
      message: "source",
      origin: { source: "test", instance: null },
      partition: "source",
    }], true);

    await mergePartition(dir, { from: "source", to: "target" });

    const files = listFilesRecursive(path.join(dir, "target", "merge", "collision")).map((item) => path.basename(item));
    const merged = await getLogsForDir(dir, { partition: "target", groupKey: "merge.collision", limit: 10 });

    expect(files).toContain("2026-05-17-10-0000-info.jsonl");
    expect(files).toContain("2026-05-17-10-0001-info.jsonl.gz");
    expect(merged.logs.map((row) => row.message)).toEqual(["target", "source"]);
    expect(merged.logs.every((row) => row.partition === "target")).toBe(true);
  });

  test("deletes temporary partitions by age filters and deletes log files by bucket filters", async () => {
    const dir = tempDir();
    await createPartition(dir, "old-temp", { temporary: true });
    await createPartition(dir, "new-temp", { temporary: true });
    await createPartition(dir, "stable", { temporary: false });

    const oldMarker = readPartitionMarker(dir, "old-temp");
    const newMarker = readPartitionMarker(dir, "new-temp");
    const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const newDate = new Date().toISOString();

    writePartitionMarker(dir, "old-temp", { ...oldMarker, created_at: oldDate, updated_at: oldDate });
    writePartitionMarker(dir, "new-temp", { ...newMarker, created_at: newDate, updated_at: newDate });

    const deletedTemps = await deletePartitions(dir, { temporaryOnly: true, olderThanDays: 1 });
    expect(deletedTemps.items).toEqual(["old-temp"]);
    expect((await listPartitions(dir)).map((item) => item.name)).toEqual(["new-temp", "stable"]);

    const deletedStable = await deletePartition(dir, "stable");
    expect(deletedStable.items).toEqual(["stable"]);

    const rootLog = createLog({ dir, console: false, quiet: true });
    const alphaLog = createLog({ dir, partition: "alpha", console: false, quiet: true });
    const tempLog = createLog({ dir, partition: "temp-logs", temporaryPartition: true, console: false, quiet: true });

    rootLog.info("jobs.queue", "root", forceRecordedAt("2026-05-17T10:00:00.000Z"));
    alphaLog.warn("jobs.queue", "alpha-warn", forceRecordedAt("2026-05-17T10:00:00.000Z"));
    alphaLog.info("jobs.queue", "alpha-info", forceRecordedAt("2026-05-17T11:00:00.000Z"));
    tempLog.warn("jobs.queue", "temp-warn", forceRecordedAt("2026-05-17T10:00:00.000Z"));
    await rootLog.flush();
    await alphaLog.flush();
    await tempLog.flush();

    const alphaWarnFile = listFilesRecursive(path.join(dir, "alpha")).find((item) => item.endsWith("2026-05-17-10-0000-warn.jsonl"));
    const rootFile = listFilesRecursive(dir).find((item) => item.endsWith(path.join("jobs", "queue", "2026-05-17-10-0000-info.jsonl")));
    expect(alphaWarnFile).toBeTruthy();
    expect(rootFile).toBeTruthy();

    const oldFsDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(alphaWarnFile as string, oldFsDate, oldFsDate);
    fs.utimesSync(rootFile as string, oldFsDate, oldFsDate);

    const deletedAlphaWarn = await deleteLogs(dir, {
      partition: "alpha",
      groupKey: "jobs.queue",
      day: "2026-05-17",
      hour: "10",
      level: "warn",
      olderThanDays: 1,
    });
    expect(deletedAlphaWarn.files).toBe(1);
    expect(deletedAlphaWarn.logs).toBe(1);

    const deletedTempWarn = await deleteLogs(dir, {
      acrossPartitions: true,
      temporaryOnly: true,
      groupKey: "jobs.queue",
      level: "warn",
    });
    expect(deletedTempWarn.files).toBe(1);
    expect(deletedTempWarn.items[0].partition).toBe("temp-logs");

    const deletedRoot = await deleteLogs(dir, {
      partition: null,
      olderThanDays: 1,
      groupKey: "jobs.queue",
      level: "info",
    });
    expect(deletedRoot.files).toBe(1);
    expect(deletedRoot.items[0].partition).toBe(null);

    const alphaRemaining = await getLogsForDir(dir, { partition: "alpha", groupKey: "jobs.queue", limit: 10 });
    const rootRemaining = await getLogsForDir(dir, { partition: null, groupKey: "jobs.queue", limit: 10 });
    const tempRemaining = await getLogsForDir(dir, { partition: "temp-logs", groupKey: "jobs.queue", limit: 10 });

    expect(alphaRemaining.logs.map((row) => row.message)).toEqual(["alpha-info"]);
    expect(rootRemaining.logs).toHaveLength(0);
    expect(tempRemaining.logs).toHaveLength(0);

    await rootLog.close();
    await alphaLog.close();
    await tempLog.close();
  });
});
