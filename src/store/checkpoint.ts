import fs from "node:fs";

const PASSIVE_INTERVAL_MS = 250;
const IDLE_TRUNCATE_MS = 1_000;
const WAL_SIZE_CHECK_MS = 60_000;
const WAL_TRUNCATE_BYTES = 64 * 1024 * 1024;

type CheckpointMode = "PASSIVE" | "TRUNCATE";

type WorkerReply =
| {
  type: "done";
  id: number;
  error?: string;
}
| {
  type: "closed";
};

type PendingRequest = {
  resolve: () => void;
  reject: (error: Error) => void;
};

const pending = new Map<number, PendingRequest>();
let sharedWorker: Worker | null = null;
let workerUsers = 0;
let nextRequestId = 1;

function workerUrl(): string {
  const entry = import.meta.url.endsWith(".ts") ? "./checkpoint_worker.ts" : "./checkpoint_worker.js";
  return new URL(entry, import.meta.url).href;
}

function settleReply(reply: WorkerReply): void {
  if (reply.type === "closed") {
    if (sharedWorker) sharedWorker.terminate();
    sharedWorker = null;
    return;
  }
  const request = pending.get(reply.id);
  if (!request) return;
  pending.delete(reply.id);
  if (reply.error) request.reject(new Error(reply.error));
  else request.resolve();
}

function ensureWorker(): Worker {
  if (sharedWorker) return sharedWorker;
  const worker = new Worker(workerUrl());
  worker.onmessage = (event: MessageEvent<WorkerReply>) => settleReply(event.data);
  worker.unref();
  sharedWorker = worker;
  return worker;
}

function releaseWorker(): void {
  workerUsers = Math.max(0, workerUsers - 1);
  if (workerUsers > 0 || !sharedWorker) return;
  sharedWorker.postMessage({ type: "shutdown" });
}

function walBytes(file: string): number {
  try {
    return fs.statSync(`${file}-wal`).size;
  } catch {
    return 0;
  }
}

class StoreCheckpointer {
  private file: string;
  private opened = false;
  private closed = false;
  private lastPassiveAt = 0;
  private lastSizeCheckAt = performance.now();
  private idleTimer: ReturnType<typeof setTimeout>|null = null;

  constructor(file: string) {
    this.file = file;
  }

  noteWrite(): void {
    if (this.closed) return;
    const now = performance.now();
    if (now - this.lastPassiveAt >= PASSIVE_INTERVAL_MS) {
      this.lastPassiveAt = now;
      this.post({ type: "checkpoint", mode: "PASSIVE" });
    }
    this.truncateLargeWal(now);
    this.scheduleIdleTruncate();
  }

  checkpoint(mode: CheckpointMode = "PASSIVE"): Promise<void> {
    return this.request({ type: "checkpoint", mode });
  }

  snapshot(outputPath: string): Promise<void> {
    return this.request({ type: "snapshot", outputPath });
  }

  close(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.closed) return;
    this.closed = true;
    if (!this.opened) return;
    ensureWorker().postMessage({ type: "close", file: this.file });
    releaseWorker();
  }

  private connect(): Worker {
    const worker = ensureWorker();
    if (!this.opened) {
      this.opened = true;
      workerUsers += 1;
      worker.postMessage({ type: "open", file: this.file });
    }
    return worker;
  }

  private post(message: Record<string, unknown>): void {
    if (this.closed) return;
    this.connect().postMessage({ ...message, file: this.file });
  }

  private request(message: Record<string, unknown>): Promise<void> {
    if (this.closed) return Promise.reject(new Error("log-store-closed"));
    const id = nextRequestId;
    nextRequestId += 1;
    return new Promise<void>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        this.connect().postMessage({ ...message, file: this.file, id });
    });
  }

  private truncateLargeWal(now: number): void {
    if (now - this.lastSizeCheckAt < WAL_SIZE_CHECK_MS) return;
    this.lastSizeCheckAt = now;
    if (walBytes(this.file) > WAL_TRUNCATE_BYTES) {
      this.post({ type: "checkpoint", mode: "TRUNCATE" });
    }
  }

  private scheduleIdleTruncate(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        this.post({ type: "checkpoint", mode: "TRUNCATE" });
      }, IDLE_TRUNCATE_MS);
    if (typeof this.idleTimer.unref === "function") this.idleTimer.unref();
  }
}

export { StoreCheckpointer };
