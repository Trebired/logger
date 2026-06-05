import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { copyPartition, createLog, createPartition, deleteLogs, deletePartition, deletePartitions, getLogsForDir, getPartitionErrorCode, isPartitionError, listPartitions, mergePartition, movePartition, renamePartition } from "../../src/index";
import { forceRecordedAt, listFilesRecursive, readPartitionMarker, tempDir, writePartitionLogFile, writePartitionMarker } from "./helpers";

describe("partition lifecycle", () => {
  test("merges promoted partitions into an existing final partition only when requested", async () => {
    const dir = tempDir("partition_test_");
    const finalLog = createLog({ dir, partition: "final", console: false, quiet: true });
    const tempLog = createLog({ dir, partition: "temp", temporaryPartition: true, console: false, quiet: true });
    finalLog.info("jobs.merge", "final-before", forceRecordedAt("2026-05-17T10:00:00.000Z"));
    tempLog.info("jobs.merge", "temp-before", forceRecordedAt("2026-05-17T10:05:00.000Z"));
    await finalLog.flush();
    await tempLog.flush();
    const result = await tempLog.promotePartition("final", { merge: true });
    tempLog.info("jobs.merge", "temp-after", forceRecordedAt("2026-05-17T10:10:00.000Z"));
    await tempLog.flush();
    expect(result.action).toBe("merged");
    expect(result.sourceExisted).toBe(true);
    expect(result.targetExisted).toBe(true);
    expect((await getLogsForDir(dir, { partition: "final", groupKey: "jobs.merge", limit: 10 })).logs.map((row) => row.message)).toEqual(["final-before", "temp-before", "temp-after"]);
    await finalLog.close();
    await tempLog.close();
  });

  test("finalizePartition can switch to an existing target without app-owned fallback logic", async () => {
    const dir = tempDir("partition_test_");
    const finalLog = createLog({ dir, partition: "final", console: false, quiet: true });
    const tempLog = createLog({ dir, partition: "temp-switch", temporaryPartition: true, console: false, quiet: true });

    finalLog.info("jobs.switch", "final-only", forceRecordedAt("2026-05-17T10:00:00.000Z"));
    tempLog.info("jobs.switch", "temp-only", forceRecordedAt("2026-05-17T10:05:00.000Z"));
    await finalLog.flush();
    await tempLog.flush();

    const result = await tempLog.finalizePartition("final", { ifExists: "switch" });

    expect(result.action).toBe("switched");
    expect(result.sourceExisted).toBe(true);
    expect(result.targetExisted).toBe(true);
    expect(tempLog.getPartition()).toBe("final");
    expect(fs.existsSync(path.join(dir, "temp-switch"))).toBe(false);
    expect((await getLogsForDir(dir, { partition: "final", groupKey: "jobs.switch", limit: 10 })).logs.map((row) => row.message)).toEqual(["final-only"]);

    await finalLog.close();
    await tempLog.close();
  });

  test("keeps low-level promotePartition strict by default and exposes structured conflict detection", async () => {
    const dir = tempDir("partition_test_");
    const finalLog = createLog({ dir, partition: "final", console: false, quiet: true });
    const tempLog = createLog({ dir, partition: "temp-error", temporaryPartition: true, console: false, quiet: true });

    finalLog.info("jobs.strict", "final", forceRecordedAt("2026-05-17T10:00:00.000Z"));
    tempLog.info("jobs.strict", "temp", forceRecordedAt("2026-05-17T10:05:00.000Z"));
    await finalLog.flush();
    await tempLog.flush();

    try {
      await tempLog.promotePartition("final");
      throw new Error("expected partition conflict");
    } catch (error) {
      expect(getPartitionErrorCode(error)).toBe("partition-already-exists");
      expect(isPartitionError(error, "partition-already-exists")).toBe(true);
    }

    await finalLog.close();
    await tempLog.close();
  });

  test("copies, renames, and moves partitions while rewriting stored row partition metadata", async () => {
    const firstDir = tempDir("partition_test_");
    const secondDir = tempDir("partition_test_");
    const log = createLog({ dir: firstDir, partition: "alpha", console: false, quiet: true });
    log.info("ops.test", "alpha");
    await log.flush();
    await log.close();
    await copyPartition({ fromDir: firstDir, from: "alpha", toDir: firstDir, to: "alpha-copy" });
    await renamePartition(firstDir, { from: "alpha-copy", to: "alpha-renamed" });
    await movePartition({ fromDir: firstDir, from: "alpha-renamed", toDir: secondDir, to: "alpha-moved" });
    expect((await getLogsForDir(secondDir, { partition: "alpha-moved", groupKey: "ops.test", limit: 10 })).logs[0].partition).toBe("alpha-moved");
  });

  test("merges partitions with sequence collision handling and preserves gzip files", async () => {
    const dir = tempDir("partition_test_");
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
    expect(files).toContain("2026-05-17-10-0000-info.jsonl");
    expect(files).toContain("2026-05-17-10-0001-info.jsonl.gz");
  });

  test("deletes temporary partitions by age filters and deletes log files by bucket filters", async () => {
    const dir = tempDir("partition_test_");
    await createPartition(dir, "old-temp", { temporary: true });
    await createPartition(dir, "new-temp", { temporary: true });
    await createPartition(dir, "stable", { temporary: false });

    const oldMarker = readPartitionMarker(dir, "old-temp");
    const newMarker = readPartitionMarker(dir, "new-temp");
    const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    writePartitionMarker(dir, "old-temp", { ...oldMarker, created_at: oldDate, updated_at: oldDate });
    writePartitionMarker(dir, "new-temp", { ...newMarker, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });

    expect((await deletePartitions(dir, { temporaryOnly: true, olderThanDays: 1 })).items).toEqual(["old-temp"]);
    expect((await deletePartition(dir, "stable")).items).toEqual(["stable"]);

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
    const oldFsDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(alphaWarnFile as string, oldFsDate, oldFsDate);
    fs.utimesSync(rootFile as string, oldFsDate, oldFsDate);

    expect((await deleteLogs(dir, { partition: "alpha", groupKey: "jobs.queue", day: "2026-05-17", hour: "10", level: "warn", olderThanDays: 1 })).files).toBe(1);
    expect((await deleteLogs(dir, { acrossPartitions: true, temporaryOnly: true, groupKey: "jobs.queue", level: "warn" })).items[0].partition).toBe("temp-logs");
    expect((await deleteLogs(dir, { partition: null, olderThanDays: 1, groupKey: "jobs.queue", level: "info" })).items[0].partition).toBe(null);

    expect((await getLogsForDir(dir, { partition: "alpha", groupKey: "jobs.queue", limit: 10 })).logs.map((row) => row.message)).toEqual(["alpha-info"]);
    await rootLog.close();
    await alphaLog.close();
    await tempLog.close();
  });
});
