import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createLog, getEntriesForDir, logStream } from "../src/index";

const handlers: any[] = [];

function tempDir(): string {
  const parent = path.join(os.tmpdir(), "@trebired-logger");
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, "test_"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function captureNextLog(fn: (log: any) => void) {
  const log = createLog({ console: false, save: false });
  const events: any[] = [];
  const handler = (entry: any, context: any) => events.push({ entry, context });
  handlers.push(handler);
  logStream.on("log", handler);
  fn(log);
  return events[events.length - 1];
}

function listFilesRecursive(dir: string): string[] {
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

function captureStdout(fn: () => void): string {
  const originalWrite = process.stdout.write;
  let output = "";

  try {
    (process.stdout as any).write = (chunk: unknown) => {
      output += String(chunk);
      return true;
    };
    fn();
  } finally {
    (process.stdout as any).write = originalWrite;
  }

  return output;
}

function forceRecordedAt(value: string): Record<string, unknown> {
  return { __recorded_at: value };
}

afterEach(() => {
  while (handlers.length) {
    const handler = handlers.pop();
    logStream.off("log", handler);
  }
});

describe("@trebired/logger", () => {
  test("uses the configured success level for the package greeting", () => {
    const output = captureStdout(() => {
      createLog({
        save: false,
        console: {
          colors: true,
          timestamp: false,
          group: false,
          metadata: false,
        },
        levels: {
          success: { weight: 25, label: "YAY", color: "#123456" },
        },
      });
    });

    expect(output).toContain("@trebired/logger initialized");
    expect(output).toContain("\x1b[38;2;18;52;86mYAY\x1b[0m");
  });

  test("logs without saving when save is false", async () => {
    const event = captureNextLog((log) => {
      log.info("worker.step", "complete", {
        attempt: 1,
        config_key: "reserved",
        log_root: "/tmp/old-name",
        source: "reserved",
      });
    });

    expect(event.entry.group).toBe("worker.step");
    expect(event.entry.message).toBe("complete");
    expect(event.entry.metadata).toEqual({ attempt: 1 });
    expect(event.entry.origin).toEqual({ source: "app", instance: null });
    expect(event.context).toEqual({ dir: "" });
  });

  test("uses default as the implicit group", () => {
    const event = captureNextLog((log) => {
      log.info("implicit group message");
    });

    expect(event.entry.group).toBe("default");
    expect(event.entry.message).toBe("implicit group message");
  });

  test("defaults save to true when dir is provided and stores by group directory", async () => {
    const dir = tempDir();
    const log = createLog({ dir, console: false });

    log.success("billing.invoice", "created", { invoiceId: "inv-1" });
    await log.flush();

    const result = await getEntriesForDir(dir, { level: "success", groupKey: "billing.invoice", limit: 10 });
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].message).toBe("created");
    expect(result.logs[0].metadata).toEqual({ invoiceId: "inv-1" });
    expect(result.levels.success.color).toBe("#51b300");
    expect(result.metadata).toEqual({
      dir,
      count: 1,
      query: { level: "success", groupKey: "billing.invoice", day: "", hour: "", limit: 10 },
    });
    expect(fs.existsSync(path.join(dir, "billing", "invoice"))).toBe(true);
    await log.close();
  });

  test("supports async queue writes and flush", async () => {
    const dir = tempDir();
    const log = createLog({ dir, console: false });

    log.info("queue.test", "first");
    log.info("queue.test", "second");
    await log.flush();

    const result = await log.getAll({ groupKey: "queue.test", limit: 10 });
    expect(result.logs.map((row) => row.message)).toEqual(["first", "second"]);
    expect(log.getStats().written).toBe(2);
    await log.close();
  });

  test("supports sync write mode", async () => {
    const dir = tempDir();
    const log = createLog({ dir, console: false, write: { mode: "sync" } });

    log.info("sync.test", "written");

    const result = await getEntriesForDir(dir, { groupKey: "sync.test", limit: 10 });
    expect(result.logs.map((row) => row.message)).toEqual(["written"]);
    expect(log.getStats().mode).toBe("sync");
    await log.close();
  });

  test("can hide optional console fields while always showing level and message", () => {
    const output = captureStdout(() => {
      const log = createLog({
        save: false,
        console: {
          colors: false,
          timestamp: false,
          group: false,
          metadata: false,
        },
      });

      log.info("console.test", "visible message", { hidden: true });
    });

    expect(output).toContain("[INFO] visible message");
    expect(output).not.toContain("console.test");
    expect(output).not.toContain("hidden");
    expect(output).not.toContain("|");
  });

  test("uses top-level timezone for saved file names", async () => {
    const instant = "2026-05-03T13:00:00.000Z";
    const cases = [
      { timeZone: "Europe/Prague", expected: "2026-05-03-15-0000-info.jsonl" },
      { timeZone: "America/New_York", expected: "2026-05-03-09-0000-info.jsonl" },
      { timeZone: "UTC", expected: "2026-05-03-13-0000-info.jsonl" },
    ];

    for (const item of cases) {
      const dir = tempDir();
      const log = createLog({ dir, console: false, timeZone: item.timeZone });

      log.info("timezone.saved", "saved", forceRecordedAt(instant));
      await log.flush();

      expect(fs.existsSync(path.join(dir, "timezone", "saved", item.expected))).toBe(true);
      const result = await log.getAll({ groupKey: "timezone.saved", limit: 1 });
      expect(result.logs[0].recorded_at).toBe(instant);
      await log.close();
    }
  });

  test("falls back to New York timezone for invalid timezone input", async () => {
    const dir = tempDir();
    const log = createLog({ dir, console: false, timeZone: "Not/A_Timezone" });

    log.info("timezone.fallback", "saved", forceRecordedAt("2026-05-03T13:00:00.000Z"));
    await log.flush();

    expect(fs.existsSync(path.join(dir, "timezone", "fallback", "2026-05-03-09-0000-info.jsonl"))).toBe(true);
    await log.close();
  });

  test("uses top-level timezone and European console locale for display timestamps", () => {
    const output = captureStdout(() => {
      const log = createLog({
        save: false,
        timeZone: "Europe/Prague",
        console: {
          colors: false,
          locale: "cs-CZ",
        },
      });

      log.info("console.timezone", "visible message", forceRecordedAt("2026-05-03T13:00:00.000Z"));
    });

    expect(output).toContain("|03.05.2026, 15:00:00|");
    expect(output).toContain("[INFO, console.timezone] visible message");
  });

  test("uses the same European timestamp style for other matching locales", () => {
    const output = captureStdout(() => {
      const log = createLog({
        save: false,
        quiet: true,
        timeZone: "Europe/Prague",
        console: {
          colors: false,
          locale: "de-DE",
        },
      });

      log.info("console.timezone", "visible message", forceRecordedAt("2026-05-03T13:00:00.000Z"));
    });

    expect(output).toContain("|03.05.2026, 15:00:00|");
  });

  test("uses runtime default locale when console locale is invalid", () => {
    const invalidLocaleOutput = captureStdout(() => {
      const log = createLog({
        save: false,
        timeZone: "UTC",
        console: {
          colors: false,
          locale: "not-a-locale",
        },
      });

      log.info("console.locale", "visible message", forceRecordedAt("2026-05-03T13:00:00.000Z"));
    });
    const runtimeLocaleOutput = captureStdout(() => {
      const log = createLog({
        save: false,
        timeZone: "UTC",
        console: {
          colors: false,
        },
      });

      log.info("console.locale", "visible message", forceRecordedAt("2026-05-03T13:00:00.000Z"));
    });

    expect(invalidLocaleOutput).toBe(runtimeLocaleOutput);
  });

  test("tracks queue overflow with drop-newest", async () => {
    const dir = tempDir();
    const log = createLog({
      dir,
      console: false,
      write: { mode: "async", maxQueue: 1, overflow: "drop-newest" },
    });

    log.info("overflow.test", "kept");
    log.info("overflow.test", "dropped");
    await log.flush();

    const result = await log.getAll({ groupKey: "overflow.test", limit: 10 });
    expect(result.logs.map((row) => row.message)).toEqual(["kept"]);
    expect(log.getStats().dropped).toBe(1);
    await log.close();
  });

  test("rolls files by max size using sequence suffixes", async () => {
    const dir = tempDir();
    const log = createLog({
      dir,
      console: false,
      retention: { maxFileSize: 80 },
    });

    log.info("roll.test", "first-long-message", { data: "x".repeat(100) });
    log.info("roll.test", "second-long-message", { data: "y".repeat(100) });
    await log.flush();

    const files = listFilesRecursive(path.join(dir, "roll", "test")).map((file) => path.basename(file));
    expect(files.some((file) => file.includes("-0000-info.jsonl"))).toBe(true);
    expect(files.some((file) => file.includes("-0001-info.jsonl"))).toBe(true);
    await log.close();
  });

  test("runs retention cleanup for old files", async () => {
    const dir = tempDir();
    const groupDir = path.join(dir, "old", "logs");
    fs.mkdirSync(groupDir, { recursive: true });
    const oldFile = path.join(groupDir, "2000-01-01-00-0000-info.jsonl");
    fs.writeFileSync(oldFile, "{}\n");
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, oldDate, oldDate);

    const log = createLog({ dir, console: false, retention: { maxAgeDays: 7 } });
    await sleep(50);

    expect(fs.existsSync(oldFile)).toBe(false);
    await log.close();
  });

  test("optionally compresses old files and queries gzip rows", async () => {
    const dir = tempDir();
    const groupDir = path.join(dir, "compress", "logs");
    fs.mkdirSync(groupDir, { recursive: true });
    const oldFile = path.join(groupDir, "2099-01-01-00-0000-info.jsonl");
    fs.writeFileSync(oldFile, JSON.stringify({
      recorded_at: "2099-01-01T00:00:00.000Z",
      level: "info",
      group: "compress.logs",
      message: "old",
      origin: { source: "test", instance: null },
    }) + "\n");

    const log = createLog({ dir, console: false, retention: { compressOldFiles: true } });
    await sleep(50);

    expect(fs.existsSync(`${oldFile}.gz`)).toBe(true);
    const result = await getEntriesForDir(dir, { groupKey: "compress.logs", limit: 10 });
    expect(result.logs.map((row) => row.message)).toEqual(["old"]);
    await log.close();
  });

  test("supports redaction and serializers", async () => {
    const dir = tempDir();
    const log = createLog({
      dir,
      console: false,
      serializers: {
        userId: (value) => `user:${String(value)}`,
      },
      redact: {
        paths: ["nested.private"],
      },
    });

    log.info("metadata.test", "saved", {
      userId: 42,
      password: "secret",
      nested: { private: "hide", visible: "show" },
    });
    await log.flush();

    const result = await log.getAll({ groupKey: "metadata.test", limit: 10 });
    expect(result.logs[0].metadata).toEqual({
      userId: "user:42",
      password: "[REDACTED]",
      nested: { private: "[REDACTED]", visible: "show" },
    });
    await log.close();
  });

  test("sampling suppresses entries", async () => {
    const dir = tempDir();
    const log = createLog({ dir, console: false, sample: 0 });

    log.info("sample.test", "hidden");
    await log.flush();

    const result = await log.getAll({ groupKey: "sample.test", limit: 10 });
    expect(result.logs).toHaveLength(0);
    await log.close();
  });

  test("supports custom weighted levels as methods", async () => {
    const dir = tempDir();
    const log = createLog({
      dir,
      console: false,
      levels: {
        audit: { weight: 35, label: "AUDIT" },
        panic: { weight: 100, label: "PANIC" },
      },
      minLevel: "audit",
    });

    log.info("system", "filtered out");
    log.audit("billing.invoice", "created");
    log.panic("runtime", "unrecoverable");
    await log.flush();

    const result = await log.getAll({ level: "all", groupKey: "all", limit: 10 });
    expect(result.logs.map((row) => row.level)).toEqual(["audit", "panic"]);
    expect(result.levels.audit).toEqual({
      weight: 35,
      label: "AUDIT",
      color: "#ffffff",
      stream: "stdout",
      showStack: false,
      bold: false,
    });
    expect(result.levels.panic.label).toBe("PANIC");
    await log.close();
  });

  test("lets custom level configs override built-ins", async () => {
    const dir = tempDir();
    const log = createLog({
      dir,
      console: false,
      levels: {
        info: { weight: 5, label: "LOWINFO" },
        warn: { weight: 60, label: "WARN" },
      },
      minLevel: 50,
    });

    log.info("runtime", "filtered");
    log.warn("runtime", "kept");

    const result = await log.getAll({ limit: 10 });
    expect(result.logs.map((row) => row.message)).toEqual(["kept"]);
    expect(result.levels.info.label).toBe("LOWINFO");
    expect(result.levels.warn.weight).toBe(60);
    await log.close();
  });

  test("rejects invalid custom level names", () => {
    expect(() => createLog({ levels: { "Bad Level": { weight: 99 } } })).toThrow("invalid-log-level-name");
  });

  test("supports group, scope, getDir, and setDir", async () => {
    const firstDir = tempDir();
    const secondDir = tempDir();
    const log = createLog({ dir: firstDir, console: false, source: "service" });

    log.group("jobs.queue").warn("stalled", { jobId: "42" });
    await log.flush();
    log.setDir(secondDir);
    log.withScope("worker", "jobs.queue", 2).error("failed");
    await log.flush();

    expect(log.getDir()).toBe(path.resolve(secondDir));

    const firstResult = await getEntriesForDir(firstDir, { limit: 10 });
    const secondResult = await getEntriesForDir(secondDir, { limit: 10 });
    expect(firstResult.logs[0].origin).toEqual({ source: "service", instance: null });
    expect(firstResult.logs[0].metadata).toEqual({ jobId: "42" });
    expect(secondResult.logs[0].origin).toEqual({ source: "worker", instance: "2" });
    await log.close();
  });

  test("provides configurable request logger middleware", () => {
    const log = createLog({
      console: false,
      save: false,
      source: "platform",
      request: { group: "platform.request", idHeader: "x-request-id" },
    });
    const req: any = { hostname: "example.test", method: "GET", url: "/x", headers: { "x-request-id": "req-1" } };
    const res: any = { locals: { currentSubdomain: "main" } };
    let nextCalled = false;

    log.requestLogger()(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(typeof req.log.info).toBe("function");
  });

  test("close drains and prevents further writes", async () => {
    const dir = tempDir();
    const log = createLog({ dir, console: false });

    log.info("close.test", "before");
    await log.close();
    log.info("close.test", "after");

    const result = await getEntriesForDir(dir, { groupKey: "close.test", limit: 10 });
    expect(result.logs.map((row) => row.message)).toEqual(["before"]);
  });
});
