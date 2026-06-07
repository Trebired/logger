import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { createLog, getLogsForDir } from "../../src/index";
import { activeStorageBackendNotice } from "../../src/storage/backend/index";
import { captureNextLog, captureStderr, captureStdout, forceRecordedAt, listFilesRecursive, tempDir } from "./helpers";

describe("@trebired/logger", () => {
  test("uses the configured success level for the package greeting", () => {
    const output = captureStdout(() => {
      createLog({
        save: false,
        console: { colors: true, timestamp: false, group: true, metadata: false },
        levels: { success: { weight: 25, label: "YAY", color: "#123456" } },
      });
    });

    expect(output).toContain("@trebired/logger initialized");
    expect(output).toContain(activeStorageBackendNotice());
    expect(output).toContain("logger.initialize");
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
    expect(event.entry.metadata).toEqual({ attempt: 1 });
    expect(event.entry.origin).toEqual({ source: "app", instance: null });
    expect(event.context).toEqual({ runtime: "server", dir: "" });
  });

  test("uses default as the implicit group", () => {
    expect(captureNextLog((log) => log.info("implicit group message")).entry.group).toBe("default");
  });

  test("ignores any defaultGroup input and still uses default as the implicit group", () => {
    expect(captureNextLog((log) => log.info("implicit group message"), { defaultGroup: "system" } as any).entry.group).toBe("default");
  });

  test("defaults save to true when dir is provided and stores by group directory", async () => {
    const dir = tempDir();
    const log = createLog({ dir, console: false });

    log.success("billing.invoice", "created", { invoiceId: "inv-1" });
    await log.flush();

    const result = await getLogsForDir(dir, { level: "success", groupKey: "billing.invoice", limit: 10 });
    expect(result.logs[0].metadata).toEqual({ invoiceId: "inv-1" });
    expect(result.metadata.partitions.all.logs).toBe(1);
    expect(fs.existsSync(path.join(dir, "billing", "invoice"))).toBe(true);
    await log.close();
  });

  test("supports async queue writes and flush", async () => {
    const dir = tempDir();
    const log = createLog({ dir, console: false });
    log.info("queue.test", "first");
    log.info("queue.test", "second");
    await log.flush();
    expect((await log.getAllLogs({ groupKey: "queue.test", limit: 10 })).logs.map((row) => row.message)).toEqual(["first", "second"]);
    await log.close();
  });

  test("stores partitioned logs in their own folder and reports scoped totals", async () => {
    const dir = tempDir();
    const blue = createLog({ dir, partition: "blue-2026", console: false });
    const green = createLog({ dir, partition: "green-2026", console: false });

    blue.info("deploy.test", "blue-ready");
    green.info("deploy.test", "green-ready");
    await blue.flush();
    await green.flush();

    const scoped = await blue.getAllLogs({ groupKey: "deploy.test", limit: 10 });
    expect(scoped.logs[0].partition).toBe("blue-2026");
    expect(scoped.metadata.partitions.items.map((item) => item.partition)).toEqual(["blue-2026", "green-2026"]);
    expect(fs.existsSync(path.join(dir, "blue-2026", "deploy", "test"))).toBe(true);
    await blue.close();
    await green.close();
  });

  test("supports sync write mode", async () => {
    const dir = tempDir();
    const log = createLog({ dir, console: false, write: { mode: "sync" } });
    log.info("sync.test", "written");
    expect((await getLogsForDir(dir, { groupKey: "sync.test", limit: 10 })).logs.map((row) => row.message)).toEqual(["written"]);
    await log.close();
  });

  test("can hide optional console fields while always showing level and message", () => {
    const output = captureStdout(() => {
      const log = createLog({ save: false, console: { colors: false, timestamp: false, group: false, metadata: false } });
      log.info("console.test", "visible message", { hidden: true });
    });
    expect(output).toContain("[INFO] visible message");
    expect(output).not.toContain("console.test");
    expect(output).not.toContain("hidden");
  });

  test("keeps pretty error formatting while leaving stack frames raw for terminals and IDEs", () => {
    const output = captureStderr(() => {
      const log = createLog({ save: false, quiet: true, console: { colors: false, timestamp: false } });
      const error = new Error("boom");
      error.stack = [
        "Error: boom",
        "    at demo (/workspace/src/demo.ts:12:7)",
        "    at main (/workspace/src/main.ts:40:3)",
      ].join("\n");
      log.logError(error, { group: "ide.test", requestId: "req-1" });
    });

    expect(output).toContain('[ERROR, ide.test] boom {"requestId":"req-1"}');
    expect(output).toContain("/workspace/src/demo.ts:12:7");
    expect(output).toContain("Error: boom");
    expect(output).toContain("at demo (/workspace/src/demo.ts:12:7)");
    expect(output).not.toContain('"stack":');
  });

  test("tracks queue overflow with drop-newest", async () => {
    const dir = tempDir();
    const log = createLog({ dir, console: false, write: { mode: "async", maxQueue: 1, overflow: "drop-newest" } });
    log.info("overflow.test", "kept");
    log.info("overflow.test", "dropped");
    await log.flush();
    expect((await log.getAllLogs({ groupKey: "overflow.test", limit: 10 })).logs.map((row) => row.message)).toEqual(["kept"]);
    await log.close();
  });

  test("rolls files by max size using sequence suffixes", async () => {
    const dir = tempDir();
    const log = createLog({ dir, console: false, retention: { maxFileSize: 80 } });
    log.info("roll.test", "first-long-message", { data: "x".repeat(100) });
    log.info("roll.test", "second-long-message", { data: "y".repeat(100) });
    await log.flush();
    const files = listFilesRecursive(path.join(dir, "roll", "test")).map((file) => path.basename(file));
    expect(files.some((file) => /\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-1-info\.jsonl$/.test(file))).toBe(true);
    expect(files.some((file) => /\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-2-info\.jsonl$/.test(file))).toBe(true);
    await log.close();
  });

  test("supports redaction and serializers", async () => {
    const dir = tempDir();
    const log = createLog({
      dir,
      console: false,
      serializers: { userId: (value) => `user:${String(value)}` },
      redact: { paths: ["nested.private"] },
    });

    log.info("metadata.test", "saved", { userId: 42, password: "secret", nested: { private: "hide", visible: "show" } });
    await log.flush();
    expect((await log.getAllLogs({ groupKey: "metadata.test", limit: 10 })).logs[0].metadata).toEqual({
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
    expect((await log.getAllLogs({ groupKey: "sample.test", limit: 10 })).logs).toHaveLength(0);
    await log.close();
  });

  test("supports custom weighted levels as methods", async () => {
    const dir = tempDir();
    const log = createLog({
      dir,
      console: false,
      levels: { audit: { weight: 35, label: "AUDIT" }, panic: { weight: 100, label: "PANIC" } },
      minLevel: "audit",
    });
    log.info("system", "filtered out");
    log.audit("billing.invoice", "created");
    log.panic("runtime", "unrecoverable");
    await log.flush();
    expect((await log.getAllLogs({ level: "all", groupKey: "all", limit: 10 })).logs.map((row) => row.level).sort()).toEqual(["audit", "panic"]);
    await log.close();
  });
});
