import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createLog } from "../src/index";

const ITERATIONS = Number(process.env.LOGGER_BENCH_ITERATIONS || 10000);

async function runCase(name: string, factory: () => any) {
  const log = factory();
  const started = performance.now();
  for (let i = 0; i < ITERATIONS; i += 1) {
    log.info("bench.case", "entry", { i, token: "secret" });
  }
  await log.flush();
  await log.close();
  const tookMs = performance.now() - started;
  return {
    name,
    entries: ITERATIONS,
    took_ms: Math.round(tookMs * 100) / 100,
    entries_per_second: Math.round((ITERATIONS / tookMs) * 1000),
    stats: log.getStats(),
  };
}

async function runMutedConsoleCase(name: string, factory: () => any) {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  try {
    (process.stdout as any).write = () => true;
    (process.stderr as any).write = () => true;
    return await runCase(name, factory);
  } finally {
    (process.stdout as any).write = stdoutWrite;
    (process.stderr as any).write = stderrWrite;
  }
}

const tempParent = path.join(os.tmpdir(), "@trebired-logger");
fs.mkdirSync(tempParent, { recursive: true });
const base = fs.mkdtempSync(path.join(tempParent, "bench_"));

const results = [
  await runCase("disabled", () => {
    const log = createLog({ console: false, save: false });
    log.setEnabled(false);
    return log;
  }),
  await runMutedConsoleCase("console-only", () => createLog({ console: true, save: false })),
  await runCase("async-file", () => createLog({ dir: path.join(base, "async"), console: false, write: { mode: "async" } })),
  await runCase("sync-file", () => createLog({ dir: path.join(base, "sync"), console: false, write: { mode: "sync" } })),
];

process.stdout.write(`${JSON.stringify({ iterations: ITERATIONS, results }, null, 2)}\n`);
