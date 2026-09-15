import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const workDir = path.join(rootDir, ".tmp", "verify-perf");
const logDir = path.join(workDir, "logs");
const logger = await import(pathToFileURL(path.join(rootDir, "dist", "index.js")).href);

const BIG_PARTITION_ROWS = 1_000_000;
const MIN_INSERT_RATE = 200_000;
const MAX_QUERY_P95_MS = 5;
const MAX_STEADY_STALL_MS = 20;
const MAX_BURST_RECOVERY_STALL_MS = 500;
const MAX_RSS_GROWTH_MB = 50;
const STALL_WINDOW_MS = 3_000;

function assert(condition, message) {
  if (!condition) throw new Error(`perf verification failed: ${message}`);
  console.log(`ok  ${message}`);
}

function rssMb() {
  Bun.gc(true);
  return process.memoryUsage().rss / (1024 * 1024);
}

function openLogger(partition) {
  return logger.createLog({ dir: logDir, partition, console: false, quiet: true, prefix: false, retention: { enabled: false } });
}

async function measureInsertRate(log) {
  const started = performance.now();
  for (let index = 0; index < BIG_PARTITION_ROWS; index += 1) {
    log.info(`svc.g${index % 20}`, `request ${index} handled`, { index, status: 200 });
  }
  await log.flush();
  const seconds = (performance.now() - started) / 1000;
  const rate = Math.round(BIG_PARTITION_ROWS / seconds);
  assert(log.getStats().dropped === 0, "1M entries written without drops");
  assert(rate >= MIN_INSERT_RATE, `insert rate ${rate} entries/s (>= ${MIN_INSERT_RATE})`);
}

async function measureQueryLatency() {
  await logger.queryLogs(logDir, { partition: "big", limit: 100 });
  const samples = [];
  for (let run = 0; run < 40; run += 1) {
    const started = performance.now();
    const page = await logger.queryLogs(logDir, { partition: "big", limit: 100 });
    samples.push(performance.now() - started);
    if (page.entries.length !== 100) throw new Error("newest-100 query returned a short page");
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  assert(p95 < MAX_QUERY_P95_MS, `newest-100 query on 1M rows p95 ${p95.toFixed(2)} ms (< ${MAX_QUERY_P95_MS} ms)`);
}

function startStallMonitor() {
  const state = { maxStall: 0, expected: performance.now() + 5 };
  const timer = setInterval(() => {
      const now = performance.now();
      state.maxStall = Math.max(state.maxStall, now - state.expected);
      state.expected = now + 5;
    }, 5);
  return { state, stop: () => clearInterval(timer) };
}

async function measureStallWindow(partition) {
  const log = openLogger(partition);
  const monitor = startStallMonitor();
  let written = 0;
  const writer = setInterval(() => {
      for (let index = 0; index < 100; index += 1) log.warn("svc.live", `live ${written += 1}`, { written });
    }, 10);
  const reader = setInterval(() => {
      void log.queryLogs({ limit: 100 });
    }, 100);
  await new Promise((resolve) => setTimeout(resolve, STALL_WINDOW_MS));
  clearInterval(writer);
  clearInterval(reader);
  monitor.stop();
  await log.close();
  return monitor.state.maxStall;
}

function reportStoreSize() {
  const files = ["logs.db", "logs.db-wal"].map((name) => path.join(logDir, name)).filter((file) => fs.existsSync(file));
  const bytes = files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  console.log(`info store size after 1M entries: ${(bytes / (1024 * 1024)).toFixed(1)} MB`);
}

async function main() {
  fs.rmSync(workDir, { recursive: true, force: true });
  const rssBefore = rssMb();
  const steady = await measureStallWindow("steady");
  const steadyMessage = `max event-loop stall ${steady.toFixed(1)} ms logging 10k entries/s with queries`;
  assert(steady < MAX_STEADY_STALL_MS, `${steadyMessage} (< ${MAX_STEADY_STALL_MS} ms)`);
  const log = openLogger("big");
  await measureInsertRate(log);
  await measureQueryLatency();
  const recovery = await measureStallWindow("after-burst");
  const recoveryMessage = `max event-loop stall ${recovery.toFixed(1)} ms in the 3 s after the 1M-entry burst`;
  assert(recovery < MAX_BURST_RECOVERY_STALL_MS, `${recoveryMessage} (< ${MAX_BURST_RECOVERY_STALL_MS} ms)`);
  await log.close();
  reportStoreSize();
  const growth = rssMb() - rssBefore;
  assert(growth < MAX_RSS_GROWTH_MB, `RSS growth ${growth.toFixed(1)} MB (< ${MAX_RSS_GROWTH_MB} MB)`);
  fs.rmSync(workDir, { recursive: true, force: true });
  console.log("Perf verification succeeded.");
}

await main();
