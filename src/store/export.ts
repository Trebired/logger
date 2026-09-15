import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { once } from "node:events";

import type {
  ExportFormat,
  ExportLogsOptions,
  ExportLogsResult,
  LogLevelConfig,
  SnapshotStoreOptions,
  SnapshotStoreResult,
} from "#e1h3ay0cyhgl";
import type { LogStore } from "./open.js";
import { yieldToEventLoop } from "./partitions.js";
import { queryStore } from "./query.js";

const EXPORT_PAGE_SIZE = 1000;

function resolveExportFormat(outputPath: string, format: ExportFormat | undefined): ExportFormat {
  if (format === "jsonl" || format === "jsonl.gz") return format;
  return outputPath.endsWith(".gz") ? "jsonl.gz" : "jsonl";
}

async function prepareOutputPath(outputPath: string, overwrite: boolean | undefined): Promise<string> {
  const target = path.resolve(outputPath);
  if (fs.existsSync(target)) {
    if (overwrite !== true) throw new Error(`export-output-exists: ${target}`);
    await fs.promises.rm(target, { force: true });
  }
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  return target;
}

async function writeChunk(stream: NodeJS.WritableStream, chunk: string): Promise<void> {
  if (!stream.write(chunk)) await once(stream, "drain");
}

async function exportStoreLogs(
  store: LogStore,
  options: ExportLogsOptions,
  levels: Record<string, LogLevelConfig>,
): Promise<ExportLogsResult> {
  const target = await prepareOutputPath(options.outputPath, options.overwrite);
  const format = resolveExportFormat(target, options.format);
  const file = fs.createWriteStream(target);
  const gzip = format === "jsonl.gz" ? zlib.createGzip() : null;
  if (gzip) gzip.pipe(file);
  const output: NodeJS.WritableStream = gzip || file;
  const { outputPath: _outputPath, format: _format, overwrite: _overwrite, ...filters } = options;

  let entries = 0;
  let cursor: string | null = null;
  do {
    const page = queryStore(store, { ...filters, order: "asc", limit: EXPORT_PAGE_SIZE, cursor }, levels);
    if (page.entries.length) await writeChunk(output, `${page.entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    entries += page.entries.length;
    cursor = page.nextCursor;
    await yieldToEventLoop();
  } while (cursor);

  output.end();
  await once(file, "finish");
  const stat = await fs.promises.stat(target);
  return { path: target, format, entries, bytes: stat.size };
}

async function snapshotStore(store: LogStore, options: SnapshotStoreOptions): Promise<SnapshotStoreResult> {
  const target = await prepareOutputPath(options.outputPath, options.overwrite);
  await store.checkpointer.snapshot(target);
  const stat = await fs.promises.stat(target);
  return { path: target, bytes: stat.size };
}

export { exportStoreLogs, snapshotStore };
