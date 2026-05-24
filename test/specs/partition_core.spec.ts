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
    expect(created.total).toEqual({ logs: 0, dirs: 0, files: 0, bytes: 0 });
    expect((await listPartitions(dir)).map((item) => item.name)).toEqual(["staged-part"]);
    expect((await getPartitionInfo(dir, "staged-part"))?.last_activity_at).toBe(null);
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
    expect((await getLogsForDir(dir, { partition: "beta", groupKey: "jobs.queue", limit: 10 })).logs.map((row) => row.message)).toEqual(["beta-1"]);
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
    await log.promotePartition(finalPartition);
    jobs.info("after");
    await log.flush();
    expect((await listPartitions(dir)).map((item) => item.name)).toEqual([finalPartition]);
    expect((await getLogsForDir(dir, { partition: finalPartition, groupKey: "app.boot", limit: 10 })).logs.map((row) => row.message)).toEqual(["before", "after"]);
    expect(fs.existsSync(path.join(dir, tempPartition))).toBe(false);
    await log.close();
  });
});
