# @trebired/logger

Local-first JSONL logger with human-browsable group folders, durable writes, retention, redaction, query helpers, and more.

`@trebired/logger` writes JSONL logs into group-based folders on the server, supports optional partitioned storage, and now ships a framework-neutral browser runtime with an optional React adapter on top.

## Install

Runtime support: Bun 1+ and Node.js 18+.

The package can use bundled native binaries for supported Linux and macOS targets to speed up large storage/export workloads. Consumers still install a single package:

```txt
@trebired/logger
  dist/
  native/
    linux-x64-gnu.node
    linux-arm64-gnu.node
    darwin-arm64.node
    darwin-x64.node
```

At runtime the JS wrapper always tries the matching `.node` file first when one is bundled for the current platform, and falls back to the built-in JS backend if native loading is unavailable or fails. Bundled native binaries are currently published for Linux GNU (`x64` and `arm64`) and macOS targets. End users do not need Rust installed.

Set `TB_LOGGER_DISABLE_NATIVE=1` only when you explicitly want to force the JS backend.

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

Browser entrypoints:

```ts
import { createBrowserLog } from "@trebired/logger/browser";
import { LogProvider, useLog } from "@trebired/logger/browser/react";
```

## Browser Runtime

Use `@trebired/logger/browser` when you want the same levels, metadata conventions, grouping rules, and scoped logger behavior in browser code:

```ts
import { createBrowserLog } from "@trebired/logger/browser";

const log = createBrowserLog({
  group: "frontend.app",
  metadata: {
    deploymentId: "deploy-42",
    requestId: "req-abc",
  },
});

log.info("frontend boot");
await log.flush();
```

The first browser release ships with console delivery built in. It also supports custom browser transports with in-memory batching so you can add fetch, beacon, websocket, or other delivery later without changing the logger API.

There is no built-in SSR bootstrap helper in this release. If you want browser correlation data such as `requestId`, `sessionId`, or `deploymentId`, pass it explicitly through `metadata` or per-log metadata.

## React Adapter

`@trebired/logger/browser/react` is intentionally thin. It does not create a logger for you. It only helps wire an existing browser logger into React context:

```tsx
import { createRoot } from "react-dom/client";
import { createBrowserLog } from "@trebired/logger/browser";
import { LogProvider, useLog } from "@trebired/logger/browser/react";

const log = createBrowserLog({
  group: "frontend.app",
  metadata: { deploymentId: "deploy-42" },
});

function SaveButton() {
  const scopedLog = useLog("ui.save_button");
  return <button onClick={() => scopedLog.info("clicked")}>Save</button>;
}

createRoot(document.getElementById("root")!).render(
  <LogProvider log={log}>
    <SaveButton />
  </LogProvider>,
);
```

`LogErrorBoundary` is also available from `@trebired/logger/browser/react` when you want render errors logged with the shared event shape.

## Why This Logger

Most loggers either write to stdout and expect an external collector, or provide a very broad transport system. This package is intentionally opinionated around a simpler operational workflow:

- structured JSONL entries
- one directory tree per log group
- optional partition folders above group trees
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
      2026-05-03-13-00-00-1-info.jsonl
  billing/
    invoice/
      2026-05-03-13-00-00-1-audit.jsonl
```

Each line is a JSON object:

```json
{"recorded_at":"2026-05-03T13:00:00.000Z","level":"info","group":"app.start","message":"ready","origin":{"source":"app","instance":null},"metadata":{"port":3000}}
```

If you want an extra top-level separation layer, set `partition` and the logger writes one more folder layer. This is useful for deployments, releases, environments, sessions, tenants, workers, import batches, or any other caller-defined bucket:

```txt
/var/log/my-app/
  blue-2026-05-16/
    app/
      start/
        2026-05-03-13-00-00-1-info.jsonl
```

Partition names can now be built from a stable time prefix plus any caller-defined suffix:

```ts
import {
  buildPartitionName,
  buildTemporaryPartitionName,
  createLog,
} from "@trebired/logger";

const staged = buildTemporaryPartitionName({
  timeZone: "UTC",
  suffix: "deployment-unknown",
});

const final = buildPartitionName({
  timeZone: "UTC",
  suffix: "deployment-42",
});

const log = createLog({
  dir: "/var/log/my-app",
  partition: staged,
  temporaryPartition: true,
});

log.info("app.boot", "starting before final ownership is known");
await log.flush();

await log.promotePartition(final);
```

If you already have a full custom partition string, pass it directly with `partition`, or normalize it first with `sanitizePartitionName()`.

Temporary partitions are now self-cleaning: once a logger switches away from a temporary partition, promotes it, or closes, any temporary partition in that log directory that is no longer current is deleted automatically.

If you want the logger to own the common “temp first, final later” lifecycle, call `finalizePartition()` instead of open-coding a `promotePartition()` plus fallback sequence:

```ts
const result = await log.finalizePartition(final, {
  ifExists: "merge",
});

if (result.action === "switched") {
  // optional app-specific warning or telemetry
}
```

## Partition Lifecycle

You can manage partitions either from a live logger or with standalone helpers:

```ts
import {
  copyPartition,
  createPartition,
  deleteLogs,
  getPartitionInfo,
  listPartitions,
  renamePartition,
} from "@trebired/logger";

await createPartition("/var/log/my-app", "2026-05-17-12-00-00-staged", {
  temporary: true,
});

const partitions = await listPartitions("/var/log/my-app");
console.log(partitions.total.megabytes);
console.log(partitions[0]?.total.megabytes);

await renamePartition("/var/log/my-app", {
  from: "2026-05-17-12-00-00-staged",
  to: "2026-05-17-12-00-00-final",
});

await copyPartition({
  fromDir: "/var/log/my-app",
  from: "2026-05-17-12-00-00-final",
  toDir: "/var/log/archive",
  to: "2026-05-17-12-00-00-final-copy",
});

await deleteLogs("/var/log/my-app", {
  partition: "2026-05-17-12-00-00-final",
  groupKey: "jobs.queue",
  level: "warn",
  olderThanDays: 7,
});

console.log(await getPartitionInfo("/var/log/my-app", "2026-05-17-12-00-00-final"));
```

For live loggers, the package now exposes two layers:

- `promotePartition()` stays the lower-level explicit primitive. By default it still errors on target conflicts unless you pass `merge: true` or `ifExists`.
- `finalizePartition()` is the higher-level lifecycle helper for idempotent temp-to-final transitions.

`finalizePartition()` returns structured outcomes instead of forcing application code to catch expected conflicts:

```ts
const result = await log.finalizePartition("2026-05-17-12-00-00-final", {
  ifExists: "switch",
});

result.action;
// "renamed" | "merged" | "switched" | "activated-target"
// "marked-permanent" | "already-finalized"
```

Conflict policies:

- `ifExists: "error"` keeps strict low-level behavior
- `ifExists: "merge"` merges the active source partition into the existing target
- `ifExists: "switch"` activates the existing target without merging the current source

For advanced callers that still use the lower-level primitives directly, `getPartitionErrorCode()` and `isPartitionError()` can inspect partition lifecycle errors without parsing raw message strings.

## Core API

```ts
const log = createLog({
  dir: "/var/log/my-app",
  save: true,
  console: true,
  timeZone: "America/New_York",
  source: "api",
});

log.debug("app.boot", "config loaded");
log.info("app.boot", "ready");
log.success("job.import", "finished", { rows: 1200 });
log.warn("http.request", "slow request", { took_ms: 842 });
log.fail("job.import", "failed validation");
log.error("app.runtime", "uncaught error");
```

`save` defaults to `true` when `dir` is provided. If no `dir` is provided, the logger can still emit console output and live stream events.

If you log without passing a group, the logger always uses `"default"`.

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
  partition: "blue-2026-05-16",
  temporaryPartition: false,
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
    maxFileSize: "20mb",
    compressOldFiles: false,
    cleanupIntervalMs: 60_000,
    // deletion is opt-in:
    maxAgeDays: 30,
    maxPartitions: 5,
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

- logs are kept forever unless you set a retention number
- `maxFileSize: "20mb"`
- `compressOldFiles: false`

```ts
const log = createLog({
  dir: "/var/log/my-app",
  retention: {
    // only delete when you set one or both of these:
    maxAgeDays: 30,
    maxPartitions: 5,
    maxFileSize: "100mb",
    compressOldFiles: true,
    cleanupIntervalMs: 60 * 60 * 1000,
  },
});
```

`maxAgeDays` deletes old files by age. `maxPartitions` keeps only the newest partition folders by last write time. A partition can represent deployments, sessions, environments, release versions, or any other caller-defined grouping. If you omit both, the logger stores logs indefinitely.

When a file exceeds the configured size, the logger rolls to the next sequence inside the same group and timestamp bucket:

```txt
2026-05-03-13-00-00-1-info.jsonl
2026-05-03-13-00-00-2-info.jsonl
2026-05-03-13-00-00-3-info.jsonl
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

Old query names are not supported anymore. Use `getLogsForDir()`, `getAllLogs()`, and `getAllLogsAcrossPartitions()`. Do not use `getEntriesForDir()` or `getAll()`.

```ts
import { getLogsForDir } from "@trebired/logger";

const result = await getLogsForDir("/var/log/my-app", {
  level: "error",
  groupKey: "app.runtime",
  limit: 100,
});

console.log(result.logs);
console.log(result.levels.error.color);
console.log(result.metadata.count);
console.log(result.metadata.total);
```

The main instance query method is `getAllLogs()`:

```ts
const recent = await log.getAllLogs({ groupKey: "billing.invoice", limit: 50 });
console.log(recent.logs);
console.log(recent.levels);
console.log(recent.metadata.total);
```

Pass `partition: null` when you want only unpartitioned logs from a mixed directory tree.

If you use partition folders and want a merged read across every partition:

```ts
const merged = await log.getAllLogsAcrossPartitions({
  groupKey: "billing.invoice",
  limit: 100,
});

console.log(merged.logs);
console.log(merged.metadata.partitions.items);
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
```

`bun run demo` starts a small dummy system that keeps logging until interrupted. It exercises grouped and scoped loggers, custom levels, redaction, request middleware, live stream events, local querying, and write stats. It writes throwaway logs into the repo under `.demo-logs/dummy`. Microslop Windows is not supported.

The npm package exports compiled files from `dist`. Publishing runs `typecheck`, tests, and `build` through `prepublishOnly`.
