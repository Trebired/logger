import { afterEach, describe, expect, test } from "bun:test";

import { createBrowserLog } from "#gvcc9893bkqo";
import { logStream } from "#ee9snkkshbj2";

function createMemoryTransport() {
  const batches: Array<{ entries: any[]; context: any }> = [];
  let flushCount = 0;
  let closeCount = 0;

  return {
    transport: {
      name: "memory",
      write(entries: any[], context: any) {
        batches.push({
          entries: entries.map((entry) => ({ ...entry })),
          context,
        });
      },
      flush() {
        flushCount += 1;
      },
      close() {
        closeCount += 1;
      },
    },
    get entries() {
      return batches.flatMap((batch) => batch.entries);
    },
    get contexts() {
      return batches.map((batch) => batch.context);
    },
    get flushCount() {
      return flushCount;
    },
    get closeCount() {
      return closeCount;
    },
  };
}

const handlers: any[] = [];

afterEach(() => {
  while (handlers.length) {
    const handler = handlers.pop();
    logStream.off("log", handler);
  }
});

describe("browser runtime", () => {
  test("defaults to browser source and console transport formatting", async () => {
    const originalInfo = console.info;
    const calls: unknown[][] = [];

    try {
      console.info = (...args: unknown[]) => {
        calls.push(args);
      };

      const log = createBrowserLog();
      log.info("frontend boot");
      await log.close();
    } finally {
      console.info = originalInfo;
    }

    expect(String(calls[0][0])).toContain("[INFO, default] frontend boot");
    expect(String(calls[0][0])).not.toContain("\x1b");
  });

  test("applies default group, metadata, serializers, redaction, and sampling", async () => {
    const memory = createMemoryTransport();
    const log = createBrowserLog({
      console: false,
      group: "frontend.app",
      metadata: {
        deploymentId: "dep-1",
        token: "secret",
      },
      serializers: {
        userId: (value) => `user:${String(value)}`,
      },
      redact: {
        paths: ["nested.private"],
      },
      sample: (entry) => entry.message === "keep",
      transports: [memory.transport],
    });

    log.info("drop", { userId: 1 });
    log.info("keep", {
      userId: 42,
      nested: { private: "hide", visible: "show" },
    });
    await log.flush();

    expect(memory.entries).toHaveLength(1);
    expect(memory.entries[0].group).toBe("frontend.app");
    expect(memory.entries[0].origin).toEqual({ source: "browser", instance: null });
    expect(memory.entries[0].metadata).toEqual({
      deploymentId: "dep-1",
      token: "[REDACTED]",
      userId: "user:42",
      nested: { private: "[REDACTED]", visible: "show" },
    });

    await log.close();
  });

  test("supports dynamic levels, logError, and browser stream context", async () => {
    const memory = createMemoryTransport();
    const events: any[] = [];
    const handler = (entry: any, context: any) => events.push({ entry, context });
    handlers.push(handler);
    logStream.on("log", handler);

    const log = createBrowserLog({
      console: false,
      transports: [memory.transport],
      levels: {
        audit: { weight: 35, label: "AUDIT" },
      },
      minLevel: "audit",
    });

    log.info("filtered");
    log.audit("ui.audit", "kept");
    log.logError(new Error("boom"), { group: "ui.error", requestId: "req-1" }, "ui");
    await log.flush();

    expect(memory.entries.map((entry) => entry.level)).toEqual(["audit", "error"]);
    expect(memory.entries[0].group).toBe("ui.audit");
    expect(memory.entries[1].group).toBe("ui.error");
    expect(memory.entries[1].origin).toEqual({ source: "ui", instance: null });
    expect(events[events.length - 1]?.context).toEqual({ runtime: "browser", transports: ["memory"] });

    await log.close();
  });

  test("supports custom transport availability, batching, flush, and close", async () => {
    const memory = createMemoryTransport();
    const unavailable = {
      name: "skip-me",
      available() {
        return false;
      },
      write() {},
    };
    const log = createBrowserLog({
      console: false,
      transports: [unavailable as any, memory.transport],
      batch: {
        size: 10,
        delayMs: 60_000,
      },
    });

    log.info("batch.test", "first");
    log.info("batch.test", "second");

    expect(memory.entries).toHaveLength(0);

    await log.flush();

    expect(memory.entries.map((entry) => entry.message)).toEqual(["first", "second"]);
    expect(log.getStats().transports).toEqual(["memory"]);
    expect(log.getStats().written).toBe(2);
    expect(memory.flushCount).toBeGreaterThanOrEqual(1);

    await log.close();

    expect(memory.closeCount).toBe(1);
    expect(log.getStats().closed).toBe(true);
  });
});
