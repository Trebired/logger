# @trebired/logger

Structured logger for Bun that saves logs to a local SQLite database, with partitions, default retention, redaction, query and export helpers, and browser runtimes.

On the server, `@trebired/logger` writes to one database per log directory, `<dir>/logs.db`. Writes are batched and queries use indexes. Old entries are deleted by default. The package also ships a framework-neutral browser runtime with an optional React adapter.

## Install

Runtime support: Bun 1.2+ to save logs. A logger without `dir` (console and live stream only) also runs on Node.js; a logger with `dir` on Node.js prints one notice and keeps logging to the console. The browser entries run in any browser.

```sh
bun i @trebired/logger
```

## Quick Start

```ts
import { createLog } from "@trebired/logger";

const log = createLog({
  dir: "/var/log/my-app",
  console: true,
  quiet: true,
});

log.info("app.start", "ready", { port: 3000 });

const recent = await log.queryLogs({ limit: 20 });
console.log(recent.entries);
```

Browser entrypoints:

```ts
import { createBrowserLog } from "@trebired/logger/browser";
import { LogProvider, useLog } from "@trebired/logger/browser/react";
```

## Concepts

### Why This Logger

Most loggers either write to stdout and expect an external collector, or provide a very broad transport system. This package is built for a simpler operational workflow:

- structured entries with a group, level, message, origin and metadata
- one local SQLite file per log directory, no external service
- batched writes that never touch the filesystem per line
- indexed queries by partition, group, level, time and message text
- partitions for deployments, releases, sessions or any other caller-defined bucket
- custom weighted log levels
- built-in redaction for common sensitive fields
- retention that is on by default, so a busy service cannot fill the disk

### Storage

A logger with `dir: "/var/log/my-app"` writes to:

```txt
/var/log/my-app/
  logs.db
  logs.db-wal
  logs.db-shm
```

The database runs in WAL mode. Several loggers in one process can share a directory; they share one connection. A worker thread per store copies the WAL into the database and writes snapshots, so the thread that logs never waits for those disk syncs.

Each entry keeps the same shape as earlier releases:

```json
{"recorded_at":"2026-05-03T13:00:00.000Z","level":"info","group":"app.start","message":"ready","origin":{"source":"app","instance":null},"partition":null,"metadata":{"port":3000}}
```

The store keeps entry counts and byte totals per partition and per group, updated with every write batch. Partition info and group lists read those counters and never scan entries.

Releases before 3.0.0 wrote JSONL files into group folders. 3.0.0 does not read or migrate them. Delete those folders by hand when you no longer need them.

### Full API Example

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
    audit: { weight: 35, label: "AUDIT", color: "#8b5cf6" },
    panic: { weight: 100, label: "PANIC", color: "#dc2626", stream: "stderr", showStack: true, bold: true },
  },
  minLevel: "debug",
  write: {
    mode: "async",
    batchSize: 2000,
    flushIntervalMs: 50,
    maxQueue: 10000,
    overflow: "drop-newest",
  },
  retention: {
    maxAgeDays: 14,
    maxSize: "256mb",
    intervalMs: 10 * 60 * 1000,
    temporaryMaxIdleHours: 24,
  },
  redact: {
    includeDefaultSensitiveKeys: true,
    paths: ["user.password", /^headers\.authorization$/i],
    replacement: "[REDACTED]",
  },
  serializers: {
    userId: (value) => `user:${String(value)}`,
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

await log.close();
```

### Custom Levels

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

Custom level methods are available at runtime. In TypeScript, the logger exposes dynamic level methods through an index signature, so custom names work but are not autocompleted from the `levels` object.

### Scoped Loggers

```ts
const jobs = log.group("jobs.queue");
jobs.info("started", { jobId: "job_1" });

const worker = log.withScope("worker", "jobs.queue", 2);
worker.error("failed", { jobId: "job_1" });
```

### Log Group Guards

One guard may watch the groups a process emits:

```ts
import { registerLogGroupGuard } from "@trebired/logger";

registerLogGroupGuard({
  prefixes: ["acme"],
  check: ({ group, level, source }) => {
    if (!allowed(source)) throw new Error(`${source} may not log under ${group}`);
  },
});
```

The guard runs inside `prepareEntry`, where a record's group is final, so a group assembled
at runtime from pieces is read exactly like a literal one. `prefixes` is matched against the
group's first segment, so records outside it never reach the guard. Returning allows the
record; throwing stops the call at the site that made it. The registry holds one guard,
registering returns a function that releases it, and with no guard registered a record costs
one string test.

The package owns the registry and no policy: what makes a claim legitimate is for the code
that registers the guard to decide.

### Express-Style Middleware

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

### Live Stream

```ts
import { logStream } from "@trebired/logger";

logStream.on("log", (entry, context) => {
  // context.dir is the active log directory, if one is configured
});
```

## Writing

### Batched Writes, Flush, and Close

Log calls return immediately. Entries are queued and written in one transaction per batch:

- every `flushIntervalMs` (default 50 ms)
- or as soon as `batchSize` entries (default 2000) are queued; a full batch is written inline, so a synchronous burst of log calls never overflows the queue

```ts
log.info("queue.example", "queued");

await log.flush();
await log.close();
```

Every read method on a logger flushes first, so `log.queryLogs()` always sees the entries that logger wrote.

`getStats()` exposes write health:

```ts
const stats = log.getStats();
// { mode, queued, written, dropped, failed, batches, queueLength, closed }
```

`maxQueue` and `overflow` (`"drop-newest"`, `"drop-oldest"` or `"throw"`) only matter when writes cannot keep up, for example while the database is locked.

Steady logging does not pause the process for disk work. Measured on a btrfs SSD at 10,000 entries per second with queries running, the longest event-loop pause was 6 ms. Writing the backlog of a sustained burst of about a million entries at full speed has been observed to pause the process once for up to 190 ms.

For scripts or tests, sync writing inserts every entry immediately:

```ts
const log = createLog({
  dir: "./logs",
  write: { mode: "sync" },
});
```

`save` defaults to `true` when `dir` is provided. Without a `dir`, the logger still prints to the console and emits live stream events.

## Reading

### Query Saved Logs

Query a directory with `queryLogs()`, or a live logger with `log.queryLogs()`:

```ts
import { queryLogs } from "@trebired/logger";

const result = await queryLogs("/var/log/my-app", {
  partition: "*",
  minLevel: "warn",
  group: "app.runtime",
  limit: 100,
});

console.log(result.entries);
console.log(result.levels.error.color);
```

Options:

| Option | Meaning |
| --- | --- |
| `partition` | A partition name, `null` for unpartitioned entries, or `"*"` for all. `log.queryLogs()` defaults to the logger's active partition; `queryLogs(dir)` defaults to all. |
| `level` | One level name or a list of names. |
| `minLevel` | Only levels with at least this weight. |
| `group` | A group and its children: `"server"` matches `server` and `server.sync`, not `servers`. |
| `since`, `until` | ISO string, epoch milliseconds or `Date`, both inclusive. |
| `search` | Case-insensitive text match on the message. It reads every entry the other filters leave, about 0.2 s per million, so narrow it with a partition, level, group or time range. |
| `order` | `"desc"` (newest first, default) or `"asc"`. |
| `limit` | Page size, default 100, capped at 1000. |
| `cursor` | The `nextCursor` of the previous page. |
| `offset` | Skip this many entries; ignored when `cursor` is set. |
| `count` | Also return the exact number of matching entries in `total`. |
| `levels` | Custom level config used to resolve `minLevel` in `queryLogs(dir)`. |

The result is `{ entries, nextCursor, hasMore, total, levels }`. `total` is `null` unless `count: true` is passed. Counting reads every matching row, so leave it off for "newest entries" views.

`queryLogs(dir)` and the other directory functions keep the database open for 30 seconds after the last call, so repeated reads do not reopen it.

Page through everything with the cursor:

```ts
let cursor = null;
do {
  const page = await log.queryLogs({ partition: "*", order: "asc", limit: 1000, cursor });
  handle(page.entries);
  cursor = page.nextCursor;
} while (cursor);
```

List the groups with saved entries, with their counts and last write:

```ts
import { listGroups } from "@trebired/logger";

const groups = await listGroups("/var/log/my-app", { partition: "blue-2026-05-16" });
// [{ group: "app.start", entries: 12, lastAt: "2026-05-16T10:00:00.000Z" }, ...]
```

### Export and Snapshot

`exportLogs()` streams matching entries to a file as JSON lines, one entry per line. It accepts the same filters as `queryLogs()`:

```ts
import { exportLogs, snapshotStore } from "@trebired/logger";

await exportLogs("/var/log/my-app", {
  partition: "blue-2026-05-16",
  since: "2026-05-16T00:00:00Z",
  outputPath: "/tmp/blue.jsonl.gz",
  format: "jsonl.gz",
});

await snapshotStore("/var/log/my-app", {
  outputPath: "/backups/logs.db",
});
```

`format` is `"jsonl"` or `"jsonl.gz"`. When it is omitted, a path ending in `.gz` is compressed. `snapshotStore()` writes a consistent, compacted copy of the whole database on the store's worker thread while loggers keep writing. Both refuse to overwrite an existing file unless `overwrite: true` is passed.

## Partitions

A partition labels entries with a caller-defined bucket: a deployment, release, session, tenant, worker or import batch. Entries written without a partition are unpartitioned.

```ts
import { buildPartitionName, createLog } from "@trebired/logger";

const log = createLog({
  dir: "/var/log/my-app",
  partition: buildPartitionName({ timeZone: "UTC", suffix: "staged" }),
  temporaryPartition: true,
});

log.info("app.boot", "starting before final ownership is known");

const result = await log.finalizePartition(
  buildPartitionName({ timeZone: "UTC", suffix: "deployment-42" }),
  { ifExists: "merge" },
);
```

`buildPartitionName()` builds `YYYY-MM-DD-HH-mm-ss-<sequence>[-suffix]` from a time, time zone, sequence and suffix. `sanitizePartitionName()` normalizes a custom name to letters, digits, `-` and `_`.

### Switching and Finalizing

- `log.setPartition(name, { temporary })` flushes and switches the logger to another partition. Pass `null` to write unpartitioned entries.
- `log.finalizePartition(name, { ifExists })` moves the active partition's entries to `name`, marks `name` permanent and switches the logger to it.

`ifExists` decides what happens when `name` already has entries:

- `"merge"` (default) moves the active partition's entries into it
- `"error"` throws a `partition-already-exists` error
- `"replace"` deletes the existing partition first

The result reports what happened:

```ts
result.action;
// "renamed" | "merged" | "replaced" | "activated" | "marked-permanent" | "already-final"
result.movedEntries;
result.result; // @trebired/result shape: ok, or noop for "already-final"
```

### Temporary Partitions

A partition created with `temporary: true` stays temporary until it is finalized. Retention deletes a temporary partition once it has had no writes for `temporaryMaxIdleHours` (default 24) and no live logger in the process holds it. A logger that crashed before finalizing therefore leaves its logs readable for a day.

### Managing Partitions

```ts
import {
  deletePartitions,
  getPartitionInfo,
  getPartitionErrorCode,
  listPartitions,
  renamePartition,
} from "@trebired/logger";

const info = await getPartitionInfo("/var/log/my-app", "blue-2026-05-16");
// { name, temporary, createdAt, firstAt, lastAt, entries, bytes }

const partitions = await listPartitions("/var/log/my-app");
// { items: PartitionInfo[], total: { partitions, entries, bytes } }

await renamePartition("/var/log/my-app", { from: "blue", to: "green", ifExists: "error" });

await deletePartitions("/var/log/my-app", {
  temporary: true,
  olderThan: Date.now() - 7 * 24 * 60 * 60 * 1000,
  keep: ["blue-2026-05-16"],
});
```

`bytes` counts message and metadata text, not database pages. `deletePartitions()` combines its filters: `names`, `temporary`, `olderThan` (last write before this time) and `keep`.

`getPartitionErrorCode()` and `isPartitionError()` inspect partition errors (`missing-log-dir`, `partition-already-exists`, `partition-not-found`, `partition-not-set`) without parsing messages.

## Retention

Retention is on by default:

| Option | Default | Meaning |
| --- | --- | --- |
| `maxAgeDays` | `14` | Delete entries older than this. `false` keeps entries regardless of age. |
| `maxSize` | `"256mb"` | Delete the oldest entries while the database is larger than this. `false` removes the cap. |
| `intervalMs` | `600000` | How often retention runs. The first pass runs one second after the logger opens its store. |
| `temporaryMaxIdleHours` | `24` | Delete temporary partitions idle this long that no live logger holds. |
| `enabled` | `true` | `false` stops scheduled passes for this logger. `log.runRetention()` still runs a pass on demand with the logger's limits. |

A pass deletes old entries, then idle temporary partitions, then the oldest entries until the size cap holds. It deletes in chunks of 5,000 rows and yields to the event loop between chunks, so a large pass never blocks the process. Freed pages are returned to the filesystem at the end of the pass.

Run a pass on demand:

```ts
import { runRetention } from "@trebired/logger";

await log.runRetention();
await runRetention("/var/log/my-app", { maxAgeDays: 7, maxSize: "64mb" });
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

## Sampling

```ts
const log = createLog({
  sample: 0.1,
});

const selective = createLog({
  sample: (entry) => entry.level === "error" || entry.group.startsWith("audit."),
});
```

## Browser

### Browser Runtime

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

The browser runtime ships with console delivery built in. It also supports custom transports with in-memory batching, so you can add fetch, beacon, websocket, or other delivery without changing the logger API.

There is no built-in SSR bootstrap helper. If you want browser correlation data such as `requestId`, `sessionId`, or `deploymentId`, pass it through `metadata` or per-log metadata.

### React Adapter

`@trebired/logger/browser/react` does not create a logger for you. It wires an existing browser logger into React context:

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

## Console and Time Zone

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

`level` and `message` are always shown; timestamp, group, and metadata can be hidden. `timeZone` controls the local time shown in console output and used by `buildPartitionName()`. It defaults to the host time zone, then falls back to `America/New_York`. Stored timestamps are UTC.

`console.locale` only controls display formatting. When it is omitted or invalid, JavaScript uses the runtime default locale. European dot-date locales such as `cs-CZ` and `de-DE` are formatted as `03.05.2026, 15:59:23`.

When `quiet` is not `true`, the package prints a one-time startup greeting in the same console style as normal entries. Pass `quiet: true` to suppress it.

If you log without passing a group, the logger uses `"default"`.

## Development

```sh
bun install
bun run demo
bun run typecheck
bun run build
bun ./scripts/verify/store.mjs
bun ./scripts/verify/perf.mjs
```

Committed `*.spec.ts` and `*.spec.tsx` files are banned by Code Discipline, so this package does not expose a test script. `scripts/verify/store.mjs` checks the built store end to end: counters, paging, filters, partitions, retention, export and snapshot. `scripts/verify/perf.mjs` asserts write throughput, query latency, event-loop stalls and memory growth.

`bun run demo` starts a small dummy system that keeps logging until interrupted. It exercises grouped and scoped loggers, custom levels, redaction, request middleware, live stream events, querying, and write stats. It writes throwaway logs into the repo under `.demo-logs/dummy`. Microslop Windows is not supported.

The published package exports compiled files from `dist`. Publishing runs `typecheck` and package verification through `prepublishOnly`.

## What It Does Not Do

This package does not:

- replace a full observability stack
- ship logs to a remote collector
- force one transport, server framework, or deployment model
- infer product-specific redaction policy
