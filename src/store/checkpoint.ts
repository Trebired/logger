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

function workerUrl(): string {
  const entry = import.meta.url.endsWith(".ts") ? "./checkpoint_worker.ts" : "./checkpoint_worker.js";
  return new URL(entry, import.meta.url).href;
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
  private worker: Worker | null = null;
  private lastPassiveAt = 0;
  private lastSizeCheckAt = performance.now();
  private idleTimer: ReturnType<typeof setTimeout>|null = null;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();

  constructor(file: string) {
    this.file = file;
  }

  noteWrite(): void {
    const now = performance.now();
    if (now - this.lastPassiveAt >= PASSIVE_INTERVAL_MS) {
      this.lastPassiveAt = now;
      this.ensureWorker().postMessage({ type: "checkpoint", mode: "PASSIVE" });
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
    for (const request of this.pending.values()) request.reject(new Error("log-store-closed"));
    this.pending.clear();
    if (this.worker) this.worker.postMessage({ type: "close" });
  }

  private request(message: Record<string, unknown>): Promise<void> {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise<void>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.ensureWorker().postMessage({ ...message, id });
    });
  }

  private truncateLargeWal(now: number): void {
    if (now - this.lastSizeCheckAt < WAL_SIZE_CHECK_MS) return;
    this.lastSizeCheckAt = now;
    if (walBytes(this.file) > WAL_TRUNCATE_BYTES) {
      this.ensureWorker().postMessage({ type: "checkpoint", mode: "TRUNCATE" });
    }
  }

  private scheduleIdleTruncate(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        if (this.worker) this.worker.postMessage({ type: "checkpoint", mode: "TRUNCATE" });
      }, IDLE_TRUNCATE_MS);
    if (typeof this.idleTimer.unref === "function") this.idleTimer.unref();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(workerUrl());
    worker.onmessage = (event: MessageEvent<WorkerReply>) => this.handleReply(worker, event.data);
    worker.unref();
    worker.postMessage({ type: "open", file: this.file });
    this.worker = worker;
    return worker;
  }

  private handleReply(worker: Worker, reply: WorkerReply): void {
    if (reply.type === "closed") {
      worker.terminate();
      if (this.worker === worker) this.worker = null;
      return;
    }
    const request = this.pending.get(reply.id);
    if (!request) return;
    this.pending.delete(reply.id);
    if (reply.error) request.reject(new Error(reply.error));
    else request.resolve();
  }
}

export { StoreCheckpointer };
