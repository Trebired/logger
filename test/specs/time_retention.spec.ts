import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { createLog, getLogsForDir } from "#ee9snkkshbj2";
import { captureStdout, forceRecordedAt, sleep, tempDir } from "./helpers";

describe("@trebired/logger", () => {
  test("uses top-level timezone for saved file names", async () => {
    const instant = "2026-05-03T13:00:00.000Z";
    for (const item of [
      { timeZone: "Europe/Prague", expected: "2026-05-03-15-00-00-1-info.jsonl" },
      { timeZone: "America/New_York", expected: "2026-05-03-09-00-00-1-info.jsonl" },
      { timeZone: "UTC", expected: "2026-05-03-13-00-00-1-info.jsonl" },
    ]) {
      const dir = tempDir();
      const log = createLog({ dir, console: false, timeZone: item.timeZone });
      log.info("timezone.saved", "saved", forceRecordedAt(instant));
      await log.flush();
      expect(fs.existsSync(path.join(dir, "timezone", "saved", item.expected))).toBe(true);
      await log.close();
    }
  });

  test("falls back to New York timezone for invalid timezone input", async () => {
    const dir = tempDir();
    const log = createLog({ dir, console: false, timeZone: "Not/A_Timezone" });
    log.info("timezone.fallback", "saved", forceRecordedAt("2026-05-03T13:00:00.000Z"));
    await log.flush();
    expect(fs.existsSync(path.join(dir, "timezone", "fallback", "2026-05-03-09-00-00-1-info.jsonl"))).toBe(true);
    await log.close();
  });

  test("uses top-level timezone and European console locale for display timestamps", () => {
    const output = captureStdout(() => {
      const log = createLog({ save: false, timeZone: "Europe/Prague", console: { colors: false, locale: "cs-CZ" } });
      log.info("console.timezone", "visible message", forceRecordedAt("2026-05-03T13:00:00.000Z"));
    });
    expect(output).toContain("|03.05.2026, 15:00:00|");
  });

  test("uses the same European timestamp style for other matching locales", () => {
    const output = captureStdout(() => {
      const log = createLog({ save: false, quiet: true, timeZone: "Europe/Prague", console: { colors: false, locale: "de-DE" } });
      log.info("console.timezone", "visible message", forceRecordedAt("2026-05-03T13:00:00.000Z"));
    });
    expect(output).toContain("|03.05.2026, 15:00:00|");
  });

  test("uses runtime default locale when console locale is invalid", () => {
    const invalidLocaleOutput = captureStdout(() => {
      createLog({ save: false, timeZone: "UTC", console: { colors: false, locale: "not-a-locale" } })
        .info("console.locale", "visible message", forceRecordedAt("2026-05-03T13:00:00.000Z"));
    });
    const runtimeLocaleOutput = captureStdout(() => {
      createLog({ save: false, timeZone: "UTC", console: { colors: false } })
        .info("console.locale", "visible message", forceRecordedAt("2026-05-03T13:00:00.000Z"));
    });
    expect(invalidLocaleOutput).toBe(runtimeLocaleOutput);
  });

  test("runs retention cleanup for old files", async () => {
    const dir = tempDir();
    const oldFile = path.join(dir, "old", "logs", "2000-01-01-00-00-00-1-info.jsonl");
    fs.mkdirSync(path.dirname(oldFile), { recursive: true });
    fs.writeFileSync(oldFile, "{}\n");
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, oldDate, oldDate);
    const log = createLog({ dir, console: false, retention: { maxAgeDays: 7 } });
    await sleep(50);
    expect(fs.existsSync(oldFile)).toBe(false);
    await log.close();
  });

  test("does not delete old files when no retention number is configured", async () => {
    const dir = tempDir();
    const oldFile = path.join(dir, "forever", "logs", "2000-01-01-00-00-00-1-info.jsonl");
    fs.mkdirSync(path.dirname(oldFile), { recursive: true });
    fs.writeFileSync(oldFile, "{}\n");
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, oldDate, oldDate);
    const log = createLog({ dir, console: false, retention: {} });
    await sleep(50);
    expect(fs.existsSync(oldFile)).toBe(true);
    await log.close();
  });

  test("optionally compresses old files and queries gzip rows", async () => {
    const dir = tempDir();
    const oldFile = path.join(dir, "compress", "logs", "2099-01-01-00-00-00-1-info.jsonl");
    fs.mkdirSync(path.dirname(oldFile), { recursive: true });
    fs.writeFileSync(oldFile, `${JSON.stringify({
      recorded_at: "2099-01-01T00:00:00.000Z",
      level: "info",
      group: "compress.logs",
      message: "old",
      origin: { source: "test", instance: null },
    })}\n`);
    const log = createLog({ dir, console: false, retention: { compressOldFiles: true } });
    await sleep(50);
    expect(fs.existsSync(`${oldFile}.gz`)).toBe(true);
    expect((await getLogsForDir(dir, { groupKey: "compress.logs", limit: 10 })).logs.map((row) => row.message)).toEqual(["old"]);
    await log.close();
  });

  test("keeps only the newest partition folders when maxPartitions is configured", async () => {
    const dir = tempDir();
    const alpha = createLog({ dir, partition: "alpha", console: false });
    const beta = createLog({ dir, partition: "beta", console: false });
    alpha.info("deploy.cleanup", "alpha");
    beta.info("deploy.cleanup", "beta");
    await alpha.flush();
    await beta.flush();
    const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const newDate = new Date();
    for (const file of fs.readdirSync(path.join(dir, "alpha", "deploy", "cleanup")).map((name) => path.join(dir, "alpha", "deploy", "cleanup", name))) {
      fs.utimesSync(file, oldDate, oldDate);
    }
    for (const file of fs.readdirSync(path.join(dir, "beta", "deploy", "cleanup")).map((name) => path.join(dir, "beta", "deploy", "cleanup", name))) {
      fs.utimesSync(file, newDate, newDate);
    }
    const cleaner = createLog({ dir, console: false, retention: { maxPartitions: 1 } });
    await sleep(50);
    expect(fs.existsSync(path.join(dir, "alpha"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "beta"))).toBe(true);
    await alpha.close();
    await beta.close();
    await cleaner.close();
  });
});
