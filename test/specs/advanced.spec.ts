import { describe, expect, test } from "bun:test";
import path from "node:path";

import { createLog, getLogsForDir } from "../../src/index";
import { captureStdout, tempDir } from "./helpers";

describe("@trebired/logger", () => {
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
    const result = await log.getAllLogs({ limit: 10 });
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
    expect((await getLogsForDir(firstDir, { limit: 10 })).logs[0].origin).toEqual({ source: "service", instance: null });
    expect((await getLogsForDir(secondDir, { limit: 10 })).logs[0].origin).toEqual({ source: "worker", instance: "2" });
    await log.close();
  });

  test("provides configurable request logger middleware", () => {
    const log = createLog({ console: false, save: false, source: "platform", request: { group: "platform.request", idHeader: "x-request-id" } });
    const req: any = { hostname: "example.test", method: "GET", url: "/x", headers: { "x-request-id": "req-1" } };
    const res: any = { locals: { currentSubdomain: "main" } };
    let nextCalled = false;
    log.requestLogger()(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(typeof req.log.info).toBe("function");
  });

  test("close drains and prevents further writes", async () => {
    const dir = tempDir();
    const log = createLog({ dir, console: false });
    log.info("close.test", "before");
    await log.close();
    log.info("close.test", "after");
    expect((await getLogsForDir(dir, { groupKey: "close.test", limit: 10 })).logs.map((row) => row.message)).toEqual(["before"]);
  });
});
