# @trebired/logger

Structured backend logging for Bun and Node.js applications that want readable console output and durable local logs without running a separate logging stack.

`@trebired/logger` writes JSONL logs into group-based folders, supports custom weighted levels, queues file writes by default, and includes redaction, retention, rolling files, request-scoped loggers, and local query helpers.

## Install

Runtime support: Bun 1+ and Node.js 18+.

```sh
npm install @trebired/logger
```

```ts
import { createLog } from "@trebired/logger";

const log = createLog({
  dir: "/var/log/my-app",
  console: true,
  quiet: true,
});

log.info("app.start", "ready", { port: 3000 });
await log.flush();
```

## Why This Logger

Most loggers either write to stdout and expect an external collector, or provide a very broad transport system. This package is intentionally opinionated around a simpler operational workflow:

- structured JSONL entries
- one directory tree per log group
- async queued file writes by default
- custom weighted log levels
- local querying by group, level, day, and hour
- built-in redaction for common sensitive fields
- retention and file-size rolling without a database

The storage layout is meant to stay human-browsable:

```txt
/var/log/my-app/
  app/
    start/
      2026-05-03-13-0000-info.jsonl
  billing/
    invoice/
      2026-05-03-13-0000-audit.jsonl
```

Each line is a JSON object:

```json
{"recorded_at":"2026-05-03T13:00:00.000Z","level":"info","group":"app.start","message":"ready","origin":{"source":"app","instance":null},"metadata":{"port":3000}}
```

## Core API

```ts
const log = createLog({
  dir: "/var/log/my-app",
  save: true,
  console: true,
  timeZone: "America/New_York",
  source: "api",
  defaultGroup: "default",
});

log.debug("app.boot", "config loaded");
log.info("app.boot", "ready");
log.success("job.import", "finished", { rows: 1200 });
log.warn("http.request", "slow request", { took_ms: 842 });
log.fail("job.import", "failed validation");
log.error("app.runtime", "uncaught error");
```

`save` defaults to `true` when `dir` is provided. If no `dir` is provided, the logger can still emit console output and live stream events.

`defaultGroup` defaults to `"default"`.

`@trebired/logger` runs on both Bun and Node.js. It may print one-time package notices for runtime-specific guidance or important future package messages. For example, when it detects Node.js, it recommends Bun for best startup and file I/O performance. Pass `quiet: true` to suppress package notices:

```ts
const log = createLog({
  quiet: true,
});
```

When `quiet` is not `true`, the package also prints a one-time startup greeting using the same console logger style as normal entries.

`timeZone` is a top-level logger option because it controls the actual local moment used for saved file names and console timestamps. It defaults to the host timezone, then falls back to `America/New_York`.

Console output is configurable. `level` and `message` are always shown; timestamp, group, and metadata can be hidden. `console.locale` only controls display formatting. When `locale` is omitted or invalid, the logger passes `undefined` to `Intl.DateTimeFormat`, so JavaScript uses the runtime or system default locale:

```ts
const log = createLog({
  timeZone: "America/New_York",
  console: {
    colors: true,
    timestamp: true,
    group: false,
    metadata: false,
    locale: "en-US",
  },
});
```

Use `timeZone` for the local hour and `console.locale` for the display style.

European dot-date locales such as `cs-CZ` and `de-DE` are formatted consistently as `03.05.2026, 15:59:23`.

## Full API Example

```ts
import { createLog } from "@trebired/logger";

const log = createLog({
  dir: "/var/log/my-app",
  save: true,
  console: {
    enabled: true,
    colors: true,
    timestamp: true,
    group: true,
    metadata: true,
    locale: "en-US",
  },
  quiet: true,
  timeZone: "America/New_York",
  source: "api",
  defaultGroup: "default",
  levels: {
    debug: { weight: 10, label: "DEBUG", color: "#94a3b8" },
    info: { weight: 20, label: "INFO", color: "#38bdf8" },
    success: { weight: 25, label: "SUCCESS", color: "#22c55e", bold: true },
    warn: { weight: 30, label: "WARN", color: "#f59e0b", stream: "stderr" },
    fail: { weight: 40, label: "FAIL", color: "#fb7185", stream: "stderr" },
    error: { weight: 50, label: "ERROR", color: "#ef4444", stream: "stderr", showStack: true, bold: true },
    audit: { weight: 35, label: "AUDIT", color: "#8b5cf6" },
    panic: { weight: 100, label: "PANIC", color: "#dc2626", stream: "stderr", showStack: true, bold: true },
  },
  minLevel: "debug",
  write: {
    mode: "async",
    maxQueue: 10000,
    overflow: "drop-newest",
  },
  retention: {
    enabled: true,
    maxAgeDays: 7,
    maxFileSize: "20mb",
    compressOldFiles: false,
    cleanupIntervalMs: 60_000,
  },
  redact: {
    includeDefaultSensitiveKeys: true,
    paths: ["user.password", /^headers\.authorization$/i],
    replacement: "[REDACTED]",
  },
  serializers: {
    userId: (value) => `user:${String(value)}`,
    error: (value) =>
      value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack }
        : value,
  },
  sample: (entry) => entry.level !== "debug" || Math.random() < 0.1,
  request: {
    group: "http.request",
    idHeader: "x-request-id",
    attach: true,
  },
});

log.info("app.start", "ready", { port: 3000 });
log.audit("billing.invoice", "created", { invoiceId: "inv_123" });
log.error("app.start", "failed", { reason: "missing config" });

await log.flush();
await log.close();
```

## Custom Levels

Levels are weighted. `minLevel` filters out entries with lower weight.

```ts
const log = createLog({
  levels: {
    audit: { weight: 35, label: "AUDIT", color: "#8b5cf6" },
    panic: { weight: 100, label: "PANIC", stream: "stderr", bold: true },
  },
  minLevel: "audit",
});

log.audit("billing.invoice", "created", { invoiceId: "inv_123" });
log.panic("runtime", "unrecoverable");
```

Built-in levels are `debug`, `info`, `success`, `warn`, `fail`, and `error`. A custom level with the same name overrides the built-in config.

Custom level methods are available at runtime. In TypeScript, the logger exposes dynamic level methods through an index signature, so custom names work but are not exhaustively autocompleted from the `levels` object yet.

## Async Writes, Flush, and Close

File writes are async queued by default.

```ts
const log = createLog({
  dir: "/var/log/my-app",
  write: {
    mode: "async",
    maxQueue: 10000,
    overflow: "drop-newest",
  },
});

log.info("queue.example", "queued");

await log.flush();
await log.close();
```

`getStats()` exposes write health:

```ts
const stats = log.getStats();
// { mode, queued, written, dropped, failed, queueLength, closed }
```

For simple scripts or tests, sync writing is available:

```ts
const log = createLog({
  dir: "./logs",
  write: { mode: "sync" },
});
```

## Retention and Rolling

Defaults:

- retention enabled
- `maxAgeDays: 7`
- `maxFileSize: "20mb"`
- `compressOldFiles: false`

```ts
const log = createLog({
  dir: "/var/log/my-app",
  retention: {
    maxAgeDays: 30,
    maxFileSize: "100mb",
    compressOldFiles: true,
    cleanupIntervalMs: 60 * 60 * 1000,
  },
});
```

When a file exceeds the configured size, the logger rolls to the next sequence inside the same group and hour:

```txt
2026-05-03-13-0000-info.jsonl
2026-05-03-13-0001-info.jsonl
2026-05-03-13-0002-info.jsonl
```

## Redaction and Serializers

Common sensitive keys are redacted by default: password, token, secret, authorization, cookie, api_key, and related variants.

```ts
const log = createLog({
  redact: {
    paths: ["user.ssn", /^payment\./],
    replacement: "[hidden]",
  },
  serializers: {
    userId: (value) => `user:${value}`,
  },
});

log.info("account.update", "saved", {
  userId: 42,
  password: "secret",
  user: { ssn: "123-45-6789" },
});
```

## Scoped Loggers

```ts
const jobs = log.group("jobs.queue");
jobs.info("started", { jobId: "job_1" });

const worker = log.withScope("worker", "jobs.queue", 2);
worker.error("failed", { jobId: "job_1" });
```

## Express-Style Middleware

`requestLogger()` is compatible with Express-style middleware and attaches `req.log` by default.

```ts
app.use(log.requestLogger({
  group: "http.request",
  idHeader: "x-request-id",
}));

app.get("/", (req, res) => {
  req.log.info("handled");
  res.end("ok");
});
```

## Query Saved Logs

```ts
import { getEntriesForDir } from "@trebired/logger";

const result = await getEntriesForDir("/var/log/my-app", {
  level: "error",
  groupKey: "app.runtime",
  limit: 100,
});

console.log(result.logs);
console.log(result.levels.error.color);
console.log(result.metadata.count);
```

Logger instances also expose `getAll()`:

```ts
const recent = await log.getAll({ groupKey: "billing.invoice", limit: 50 });
console.log(recent.logs);
console.log(recent.levels);
```

## Sampling

```ts
const log = createLog({
  sample: 0.1,
});

const selective = createLog({
  sample: (entry) => entry.level === "error" || entry.group.startsWith("audit."),
});
```

## Live Stream

```ts
import { logStream } from "@trebired/logger";

logStream.on("log", (entry, context) => {
  // context.dir is the active log directory, if one is configured
});
```

## Development

```sh
bun install
bun run demo
bun test
bun run typecheck
bun run build
bun run bench
```

`bun run demo` starts a small dummy system that keeps logging until interrupted. It exercises grouped and scoped loggers, custom levels, redaction, request middleware, live stream events, local querying, and write stats. It writes throwaway logs under the OS temp directory, such as `/tmp/@trebired-logger/dummy-system` on Linux and macOS. Microslop Windows is not supported.

The npm package exports compiled files from `dist`. Publishing runs `typecheck`, tests, and `build` through `prepublishOnly`.
