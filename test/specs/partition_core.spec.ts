import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { buildPartitionName, buildTemporaryPartitionName, createLog, createPartition, formatPartitionTimePrefix, getLogsForDir, getPartitionInfo, listPartitions, sanitizePartitionName } from "../../src/index";
import { forceRecordedAt, tempDir } from "./helpers";

describe("partition lifecycle", () => {
  test("builds time-prefixed partition names and sanitizes caller suffixes", () => {
    expect(formatPartitionTimePrefix({ at: "2026-05-17T10:34:00.000Z", timeZone: "Europe/Prague" })).toBe("2026-05-17-12-0000");
    expect(buildPartitionName({ at: "2026-05-17T10:34:00.000Z", timeZone: "Europe/Prague", suffix: "deploy 42/blue" })).toBe("2026-05-17-12-0000-deploy-42-blue");
    expect(buildPartitionName({
      at: "2026-05-17T10:34:00.000Z",
      timeZone: "Europe/Prague",
      suffix: "Blue Env",
      sanitizeSuffix: (value) => value.toUpperCase().replace(/\s+/g, "_"),
    })).toBe("2026-05-17-12-0000-BLUE_ENV");
    expect(buildTemporaryPartitionName({ at: "2026-05-17T10:34:00.000Z", timeZone: "Europe/Prague", suffix: "job 1" })).toMatch(/^2026-05-17-12-0000-job-1-tmp-[a-f0-9]{8}$/);
    expect(sanitizePartitionName(" any / custom+string ")).toBe("any-custom-string");
  });

  test("creates and lists temporary partitions before logs exist", async () => {
    const dir = tempDir("partition_test_");
    const created = await createPartition(dir, "staged-part", { temporary: true });
    expect(created.total).toEqual({ logs: 0, dirs: 0, files: 0, bytes: 0, megabytes: 0 });
    const partitions = await listPartitions(dir);
    expect(partitions.map((item) => item.name)).toEqual(["staged-part"]);
    expect(partitions.total).toEqual({ partitions: 1, logs: 0, dirs: 0, files: 0, bytes: 0, megabytes: 0 });
    expect((await getPartitionInfo(dir, "staged-part"))?.last_activity_at).toBe(null);
  });

  test("reports partition sizes in megabytes for single and multi-partition reads", async () => {
    const dir = tempDir("partition_test_");
    const alpha = createLog({ dir, partition: "alpha", console: false, quiet: true });
    const beta = createLog({ dir, partition: "beta", console: false, quiet: true });
    alpha.info("jobs.queue", "alpha-1", { payload: "x".repeat(2048) });
    beta.info("jobs.queue", "beta-1", { payload: "y".repeat(1024) });
    await alpha.flush();
    await beta.flush();

    const alphaInfo = await getPartitionInfo(dir, "alpha");
    expect((alphaInfo?.total.bytes || 0) > 0).toBe(true);
    expect(alphaInfo?.total.megabytes).toBeCloseTo((alphaInfo?.total.bytes || 0) / (1024 * 1024), 8);

    const partitions = await listPartitions(dir);
    expect(partitions.total.partitions).toBe(2);
    expect(partitions.total.bytes).toBe(partitions.reduce((sum, item) => sum + item.total.bytes, 0));
    expect(partitions.total.megabytes).toBeCloseTo(partitions.total.bytes / (1024 * 1024), 8);

    await alpha.close();
    await beta.close();
  });

  test("supports live partition switching and explicit unpartitioned queries", async () => {
    const dir = tempDir("partition_test_");
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
    expect((await getLogsForDir(dir, { partition: "alpha", groupKey: "jobs.queue", limit: 10 })).logs.map((row) => row.message)).toEqual(["alpha-1"]);
    expect((await getLogsForDir(dir, { partition: "beta", groupKey: "jobs.queue", limit: 10 })).logs.map((row) => row.message)).toEqual([]);
    expect((await getLogsForDir(dir, { partition: null, groupKey: "jobs.queue", limit: 10 })).logs.map((row) => row.message)).toEqual(["root-1"]);
    await log.close();
  });

  test("promotes temporary partitions and keeps child loggers on the final partition", async () => {
    const dir = tempDir("partition_test_");
    const tempPartition = buildTemporaryPartitionName({ at: "2026-05-17T10:00:00.000Z", timeZone: "UTC", suffix: "deployment 1" });
    const finalPartition = "2026-05-17-10-0000-final";
    const log = createLog({ dir, partition: tempPartition, temporaryPartition: true, console: false, quiet: true });
    const jobs = log.group("app.boot");
    jobs.info("before");
    await log.flush();
    const result = await log.promotePartition(finalPartition);
    jobs.info("after");
    await log.flush();
    expect(result.action).toBe("renamed");
    expect(result.partition).toBe(finalPartition);
    expect(result.previousPartition).toBe(tempPartition);
    expect(result.sourceExisted).toBe(true);
    expect(result.targetExisted).toBe(false);
    expect((await listPartitions(dir)).map((item) => item.name)).toEqual([finalPartition]);
    expect((await getLogsForDir(dir, { partition: finalPartition, groupKey: "app.boot", limit: 10 })).logs.map((row) => row.message)).toEqual(["before", "after"]);
    expect(fs.existsSync(path.join(dir, tempPartition))).toBe(false);
    await log.close();
  });

  test("finalizePartition is idempotent and marks the active partition permanent", async () => {
    const dir = tempDir("partition_test_");
    const tempPartition = buildTemporaryPartitionName({ at: "2026-05-17T10:00:00.000Z", timeZone: "UTC", suffix: "deployment 2" });
    const finalPartition = "2026-05-17-10-0000-final-2";
    const log = createLog({ dir, partition: tempPartition, temporaryPartition: true, console: false, quiet: true });

    log.info("app.boot", "before");
    await log.flush();

    const first = await log.finalizePartition(finalPartition);
    const second = await log.finalizePartition(finalPartition);

    expect(first.action).toBe("renamed");
    expect(first.temporaryBefore).toBe(true);
    expect(second.action).toBe("already-finalized");
    expect(second.temporaryBefore).toBe(false);
    expect(log.getPartition()).toBe(finalPartition);
    expect((await getPartitionInfo(dir, finalPartition))?.temporary).toBe(false);

    await log.close();
  });

  test("automatically deletes temporary partitions after they stop being current", async () => {
    const dir = tempDir("partition_test_");
    const log = createLog({ dir, partition: "temp-a", temporaryPartition: true, console: false, quiet: true });
    const jobs = log.group("jobs.queue");
    jobs.info("first-temp");
    await log.flush();

    await log.setPartition("temp-b", { temporary: true });
    jobs.info("second-temp");
    await log.flush();

    expect(fs.existsSync(path.join(dir, "temp-a"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "temp-b"))).toBe(true);

    await log.close();
    expect((await listPartitions(dir)).length).toBe(0);
  });
});
