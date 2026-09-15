import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Database } from "bun:sqlite";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const workDir = path.join(rootDir, ".tmp", "verify-store");
const logDir = path.join(workDir, "logs");
const logger = await import(pathToFileURL(path.join(rootDir, "dist", "index.js")).href);

const LEVELS = ["debug", "info", "success", "warn", "fail", "error"];
const PARTITIONS = ["p0", "p1", "p2"];
const PER_PARTITION = 66_660;
const DAY_MS = 86_400_000;

function assert(condition, message) {
  if (!condition) throw new Error(`store verification failed: ${message}`);
  console.log(`ok  ${message}`);
}

function groupFor(index) {
  const slot = index % 20;
  return slot < 10 ? `svc.g${slot}` : `svc.g${slot - 10}.sub`;
}

function openLogger(options = {}) {
  return logger.createLog({ dir: logDir, console: false, quiet: true, prefix: false, retention: { enabled: false }, ...options });
}

async function seed(log) {
  for (const partition of PARTITIONS) {
    await log.setPartition(partition);
    for (let index = 0; index < PER_PARTITION; index += 1) {
      log[LEVELS[index % LEVELS.length]](groupFor(index), `${partition} m${index}.`, { index });
    }
  }
  await log.setPartition("p1");
  for (let index = 0; index < 3; index += 1) log.info("svc.g1extra", `boundary ${index}`);
  await log.flush();
  assert(log.getStats().dropped === 0, `seeded ${PER_PARTITION * PARTITIONS.length + 3} entries without drops`);
}

function verifyCounters(label) {
  const db = new Database(path.join(logDir, "logs.db"), { readonly: true });
  const partitionMismatch = db.query(`SELECT p.name FROM partitions p
    LEFT JOIN (SELECT partition_id, COUNT(*) c FROM entries GROUP BY partition_id) e ON e.partition_id = p.id
  WHERE p.entry_count != IFNULL(e.c, 0)`).all();
  const groupMismatch = db.query(`SELECT pg.partition_id FROM partition_groups pg
    LEFT JOIN (SELECT partition_id, group_id, COUNT(*) c FROM entries GROUP BY partition_id, group_id) e
    ON e.partition_id = pg.partition_id AND e.group_id = pg.group_id
  WHERE pg.entry_count != IFNULL(e.c, 0)`).all();
  db.close();
  assert(partitionMismatch.length === 0 && groupMismatch.length === 0, `${label}: counters match COUNT(*)`);
}

function isOutOfOrder(order, previous, current) {
  return previous != null && (order === "asc" ? current < previous : current > previous);
}

async function collectPages(options, useCursor) {
  const seen = new Set();
  let rows = 0;
  let cursor = null;
  let offset = 0;
  let previous = null;
  let ordered = true;
  for (;; ) {
    const page = await logger.queryLogs(logDir, { ...options, limit: 1000, cursor, offset: useCursor ? 0 : offset });
    for (const entry of page.entries) {
      const recordedAt = Date.parse(entry.recorded_at);
      if (isOutOfOrder(options.order, previous, recordedAt)) ordered = false;
      previous = recordedAt;
      seen.add(entry.message);
    }
    rows += page.entries.length;
    offset += page.entries.length;
    cursor = page.nextCursor;
    if (!page.hasMore) return { rows, unique: seen.size, ordered };
  }
}

async function verifyPaging() {
  const both = [true, false];
  const cases = [
    { label: "all levels", filters: { partition: "p0" }, expected: PER_PARTITION, modes: both },
    { label: "warn and error", filters: { partition: "p0", level: ["warn", "error"] }, expected: PER_PARTITION / 3, modes: both },
    { label: "minLevel fail", filters: { partition: "p0", minLevel: "fail" }, expected: PER_PARTITION / 3, modes: both },
    { label: "group prefix", filters: { partition: "p0", group: "svc.g1" }, expected: PER_PARTITION / 10, modes: both },
    { label: "all partitions, minLevel fail", filters: { partition: "*", minLevel: "fail" }, expected: PER_PARTITION, modes: [true] },
    { label: "all partitions, group prefix", filters: { partition: "*", group: "svc.g1" }, expected: (PER_PARTITION * 3) / 10, modes: [true] },
  ];
  for (const item of cases) {
    for (const order of ["desc", "asc"]) {
      for (const useCursor of item.modes) {
        const pages = await collectPages({ ...item.filters, order }, useCursor);
        const mode = useCursor ? "cursor" : "offset";
        const complete = pages.rows === item.expected && pages.unique === item.expected && pages.ordered;
        assert(complete, `${item.label}: ${mode} pages ${order} cover every row once, in order`);
      }
    }
  }
}

async function countOf(options) {
  return (await logger.queryLogs(logDir, { ...options, count: true, limit: 1 })).total;
}

async function verifyFilters() {
  assert(await countOf({ partition: "*" }) === PER_PARTITION * 3 + 3, "partition * counts every entry");
  assert(await countOf({ partition: null }) === 0, "partition null counts unpartitioned entries");
  assert(await countOf({ partition: "p1", group: "svc.g1" }) === PER_PARTITION / 10, "group prefix includes children, not siblings");
  assert(await countOf({ partition: "p1", group: "svc.g1extra" }) === 3, "exact sibling group");
  assert(await countOf({ partition: "p2", level: "warn" }) === PER_PARTITION / 6, "level filter");
  assert(await countOf({ partition: "p2", level: ["warn", "error"] }) === PER_PARTITION / 3, "level list filter");
  assert(await countOf({ partition: "p2", minLevel: "fail" }) === PER_PARTITION / 3, "minLevel filter");
  assert(await countOf({ partition: "p0", search: "m12345." }) === 1, "search filter");
  assert(await countOf({ partition: "p0", since: Date.now() + DAY_MS }) === 0, "since filter");
  assert(await countOf({ partition: "p0", until: 0 }) === 0, "until filter");
  const newest = await logger.queryLogs(logDir, { partition: "p0", limit: 1 });
  assert(newest.entries[0].message === `p0 m${PER_PARTITION - 1}.`, "newest entry first");
  const groups = await logger.listGroups(logDir, { partition: "p1" });
  assert(groups.length === 21 && groups.every((group) => group.entries > 0), "listGroups returns per-partition counters");
}

async function verifyFinalize(log) {
  await log.setPartition("staged", { temporary: true });
  for (let index = 0; index < 12_000; index += 1) log.info("svc.staged", `staged ${index}`);
  const merged = await log.finalizePartition("p0");
  assert(merged.action === "merged" && merged.movedEntries === 12_000, "finalize merge moves rows");
  const info = await logger.getPartitionInfo(logDir, "p0");
  assert(info.entries === PER_PARTITION + 12_000 && !info.temporary, "finalize merge updates counters");
  assert(await logger.getPartitionInfo(logDir, "staged") === null, "merged source partition is gone");
  await log.setPartition("fresh", { temporary: true });
  log.info("svc.fresh", "fresh");
  const renamed = await log.finalizePartition("final-fresh", { ifExists: "error" });
  assert(renamed.action === "renamed" && log.getPartition() === "final-fresh", "finalize renames into a new partition");
  verifyCounters("after finalize");
}

async function verifyTemporaryCleanup(log) {
  const holder = openLogger({ partition: "held-tmp", temporaryPartition: true });
  holder.info("svc.held", "held");
  await holder.flush();
  await log.setPartition("stale-tmp", { temporary: true });
  log.info("svc.stale", "stale");
  await log.setPartition("p2");
  const db = new Database(path.join(logDir, "logs.db"));
  const idleSince = Date.now() - 2 * DAY_MS;
  db.query("UPDATE partitions SET last_at = ?, created_at = ? WHERE name IN ('stale-tmp', 'held-tmp')").run(idleSince, idleSince);
  db.close();
  const result = await log.runRetention();
  const names = (await logger.listPartitions(logDir)).items.map((item) => item.name);
  assert(result.deletedPartitions === 1 && !names.includes("stale-tmp"), "idle temporary partition deleted");
  assert(names.includes("held-tmp"), "temporary partition held by a live logger kept");
  await holder.close();
}

async function verifyAgeRetention(log) {
  const db = new Database(path.join(logDir, "logs.db"));
  db.query("UPDATE entries SET recorded_at = recorded_at - ? WHERE id <= 10000").run(30 * DAY_MS);
  db.close();
  const before = await countOf({ partition: "*" });
  const released = (await logger.getPartitionInfo(logDir, "held-tmp")).entries;
  const result = await logger.runRetention(logDir, { maxSize: false });
  assert(result.deletedEntries === 10_000 + released, "age retention deletes back-dated rows");
  assert(result.deletedPartitions === 1, "released idle temporary partition deleted once its holder closed");
  assert(await countOf({ partition: "*" }) === before - 10_000 - released, "age retention leaves the rest");
  verifyCounters("after age retention");
  await log.flush();
}

async function verifyExport() {
  const filters = { partition: "p1", group: "svc.g2" };
  const expected = await countOf(filters);
  for (const format of ["jsonl", "jsonl.gz"]) {
    const outputPath = path.join(workDir, `export.${format}`);
    const result = await logger.exportLogs(logDir, { ...filters, outputPath, format, overwrite: true });
    const raw = fs.readFileSync(outputPath);
    const text = format === "jsonl.gz" ? zlib.gunzipSync(raw).toString("utf8") : raw.toString("utf8");
    const lines = text.trim().split("\n").map((line) => JSON.parse(line));
    const first = (await logger.queryLogs(logDir, { ...filters, order: "asc", limit: 1 })).entries[0];
    assert(result.entries === expected && lines.length === expected, `${format} export writes every match`);
    assert(JSON.stringify(lines[0]) === JSON.stringify(first), `${format} export round-trips entries`);
  }
}

async function verifySnapshot() {
  const outputPath = path.join(workDir, "snapshot.db");
  await logger.snapshotStore(logDir, { outputPath, overwrite: true });
  const db = new Database(outputPath, { readonly: true });
  const rows = db.query("SELECT COUNT(*) AS c FROM entries").get().c;
  db.close();
  assert(rows === await countOf({ partition: "*" }), "snapshot opens and matches the store");
}

function threadCount() {
  try {
    return fs.readdirSync("/proc/self/task").length;
  } catch {
    return 0;
  }
}

async function verifySharedCheckpointWorker() {
  const before = threadCount();
  const loggers = [];
  for (let index = 0; index < 8; index += 1) {
    const log = openLogger({ dir: path.join(workDir, `shared-${index}`) });
    log.info("svc.shared", `entry ${index}`);
    await log.flush();
    loggers.push(log);
  }
  const after = threadCount();
  for (const log of loggers) await log.close();
  assert(after - before <= 2, `8 stores share one checkpoint worker (threads ${before} to ${after})`);
}

async function verifySizeCap() {
  const file = path.join(logDir, "logs.db");
  const sizeBefore = fs.statSync(file).size;
  const result = await logger.runRetention(logDir, { maxAgeDays: false, maxSize: "2mb" });
  const sizeAfter = fs.statSync(file).size;
  assert(result.bytesAfter <= 2 * 1024 * 1024, `size cap prunes to ${result.bytesAfter} bytes`);
  assert(sizeAfter < sizeBefore / 2, `vacuum shrinks the file from ${sizeBefore} to ${sizeAfter} bytes`);
  verifyCounters("after size cap");
}

async function main() {
  fs.rmSync(workDir, { recursive: true, force: true });
  const log = openLogger();
  await seed(log);
  verifyCounters("after seed");
  await verifyPaging();
  await verifyFilters();
  await verifyFinalize(log);
  await verifyTemporaryCleanup(log);
  await verifyAgeRetention(log);
  await verifyExport();
  await verifySnapshot();
  await verifySharedCheckpointWorker();
  await log.close();
  await verifySizeCap();
  fs.rmSync(workDir, { recursive: true, force: true });
  console.log("Store verification succeeded.");
}

await main();
