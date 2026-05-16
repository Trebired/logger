import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createLog, getLogsForDir, logStream } from "../src/index";

type DemoRequest = {
  headers: Record<string, string>;
  hostname: string;
  log?: Record<string, any>;
  method: string;
  originalUrl: string;
};

type DemoResponse = {
  locals: {
    currentSubdomain?: string;
  };
};

const rootDir = path.join(os.tmpdir(), "@trebired-logger", "dummy");

function assertSupportedPlatform(): void {
  if (process.platform === "win32") {
    process.stderr.write("microslop Windows is not supported\n");
    process.exit(1);
  }
}

function resetDemoLogs(): void {
  fs.rmSync(rootDir, { recursive: true, force: true });
  fs.mkdirSync(rootDir, { recursive: true });
}

function makeRequest(tick: number): DemoRequest {
  return {
    headers: {
      host: "dummy.local",
      "x-request-id": `req_demo_${String(tick).padStart(4, "0")}`,
    },
    hostname: "dummy.local",
    method: tick % 2 === 0 ? "POST" : "GET",
    originalUrl: tick % 2 === 0 ? "/api/widgets" : "/api/widgets?limit=2",
  };
}

async function runDummySystem(): Promise<void> {
  assertSupportedPlatform();
  resetDemoLogs();

  const log = createLog({
    dir: rootDir,
    console: {
      colors: true,
      timestamp: true,
      group: true,
      metadata: true,
      locale: "en-US",
    },
    quiet: true,
    timeZone: "Europe/Prague",
    source: "dummy",
    levels: {
      audit: { weight: 35, label: "AUDIT", color: "#8b5cf6" },
      panic: { weight: 100, label: "PANIC", color: "#dc2626", stream: "stderr", bold: true, showStack: true },
    },
    write: {
      mode: "async",
      maxQueue: 1000,
      overflow: "drop-newest",
    },
    retention: {
      enabled: true,
      maxAgeDays: 3,
      maxFileSize: "512kb",
    },
    redact: {
      includeDefaultSensitiveKeys: true,
      paths: ["user.ssn", /^payment\.card/i],
      replacement: "[demo-redacted]",
    },
    serializers: {
      durationMs: (value) => `${value}ms`,
      error: (value) => (value instanceof Error ? { name: value.name, message: value.message } : value),
    },
    request: {
      group: "http.request",
      idHeader: "x-request-id",
      attach: true,
    },
  });

  const streamHandler = (entry: any, context: any) => {
    if (entry.level === "audit" || entry.level === "error") {
      process.stdout.write(`[stream:${entry.level}] ${entry.group} -> ${entry.message} (${context.dir})\n`);
    }
  };
  logStream.on("log", streamHandler);

  let tick = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  let querying = false;
  let stopping = false;

  const requestLogger = log.requestLogger();

  async function logQuerySnapshot(): Promise<void> {
    if (querying) return;
    querying = true;
    try {
      const recent = await log.getAllLogs({ groupKey: "app.heartbeat", limit: 3 });
      log.debug("logs.query", "recent heartbeat query", {
        count: recent.metadata.count,
        levels: Object.keys(recent.levels),
        latest: recent.logs.length ? recent.logs[recent.logs.length - 1].message : null,
      });

      const audit = await getLogsForDir(log.getDir(), { level: "audit", limit: 5, levels: recent.levels });
      log.debug("logs.query", "recent audit query", {
        count: audit.metadata.count,
        levelColor: audit.levels.audit.color,
      });
    } finally {
      querying = false;
    }
  }

  function logRequest(): void {
    const req = makeRequest(tick);
    const res: DemoResponse = { locals: { currentSubdomain: "demo" } };
    requestLogger(req, res, () => {
      req.log?.info("request accepted", { route: "/api/widgets" });
      if (tick % 6 === 0) req.log?.warn("request was slow", { durationMs: 80 + tick, token: "secret-demo-token" });
    });
  }

  function logTick(): void {
    tick += 1;
    log.info("app.heartbeat", "dummy system alive", { tick, pid: process.pid, logDir: rootDir });

    const worker = log.withScope("worker", "jobs.demo", tick % 3);
    worker.info("job started", { jobId: `job_demo_${tick}`, attempt: 1 });
    worker.success("job finished", { jobId: `job_demo_${tick}`, durationMs: 20 + tick });

    if (tick % 2 === 0) {
      log.audit("billing.invoice", "invoice exported", {
        invoiceId: `inv_demo_${tick}`,
        payment: { cardLast4: "4242" },
        user: { ssn: "123-45-6789" },
      });
    }

    if (tick % 3 === 0) logRequest();
    if (tick % 5 === 0) log.warn("cache.refresh", "refresh took longer than expected", { durationMs: 120 + tick });
    if (tick % 7 === 0) log.logError(new Error("demo database timeout"), { group: "db.query", durationMs: 300 + tick });
    if (tick % 4 === 0) void logQuerySnapshot();
  }

  async function stop(signal: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    if (interval) clearInterval(interval);

    log.success("app.shutdown", "dummy system stopping", { signal, ticks: tick });
    await log.flush();
    process.stdout.write(`${JSON.stringify(log.getStats(), null, 2)}\n`);
    process.stdout.write(`logs written under: ${log.getDir()}\n`);
    logStream.off("log", streamHandler);
    await log.close();
  }

  process.stdout.write(`dummy logger writing to: ${rootDir}\n`);
  process.stdout.write("press Ctrl+C to stop\n");
  log.success("app.boot", "dummy system started", { logDir: rootDir });
  logTick();
  interval = setInterval(logTick, 1000);

  await new Promise<void>((resolve) => {
    const done = (signal: string) => {
      void stop(signal).finally(resolve);
    };
    process.once("SIGINT", () => done("SIGINT"));
    process.once("SIGTERM", () => done("SIGTERM"));
  });
}

runDummySystem().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
