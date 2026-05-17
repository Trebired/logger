import { createCommonLogger } from "../core/shared.js";
import { normalizeLevels } from "../levels/index.js";
import { logStream } from "../stream/index.js";
import type {
  BrowserBatchOptions,
  BrowserLogInstance,
  BrowserLogOptions,
  BrowserLogStats,
  BrowserTransport,
  BrowserTransportContext,
  LogEntry,
} from "../types.js";
import { normalizeTimeZone } from "../utils/datetime.js";
import { asObject, toString } from "../utils/values.js";
import { createConsoleTransport } from "./console_transport.js";

type RuntimeTransport = {
  transport: BrowserTransport;
  immediate: boolean;
};

type NormalizedBrowserBatchOptions = {
  size: number;
  delayMs: number;
  maxQueue: number;
  overflow: "drop-newest" | "drop-oldest" | "throw";
};

function normalizeBatchOptions(input?: BrowserBatchOptions): NormalizedBrowserBatchOptions {
  const cfg = input && typeof input === "object" ? input : {};
  const size = Number(cfg.size);
  const delayMs = Number(cfg.delayMs);
  const maxQueue = Number(cfg.maxQueue);
  return {
    size: Number.isFinite(size) && size > 0 ? Math.floor(size) : 20,
    delayMs: Number.isFinite(delayMs) && delayMs >= 0 ? Math.floor(delayMs) : 1000,
    maxQueue: Number.isFinite(maxQueue) && maxQueue > 0 ? Math.floor(maxQueue) : 1000,
    overflow: cfg.overflow === "drop-oldest" || cfg.overflow === "throw" ? cfg.overflow : "drop-newest",
  };
}

function resolveTransports(options: BrowserLogOptions, levels: ReturnType<typeof normalizeLevels>, timeZone: string): RuntimeTransport[] {
  const transportInputs = Array.isArray(options.transports) ? options.transports : ["console"];
  const resolved: RuntimeTransport[] = [];

  for (const input of transportInputs) {
    if (input === "console") {
      if (options.console === false) continue;
      resolved.push({
        transport: createConsoleTransport({
          console: options.console,
          timeZone,
          levels,
        }),
        immediate: true,
      });
      continue;
    }

    if (!input || typeof input !== "object") continue;
    if (typeof input.available === "function" && input.available() !== true) continue;
    resolved.push({ transport: input, immediate: false });
  }

  return resolved;
}

class BrowserTransportManager {
  private immediateTransports: BrowserTransport[];
  private batchedTransports: BrowserTransport[];
  private batchOptions: NormalizedBrowserBatchOptions;
  private queue: LogEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private closed = false;
  private stats: BrowserLogStats;

  constructor(transports: RuntimeTransport[], batchOptions?: BrowserBatchOptions) {
    this.immediateTransports = transports.filter((item) => item.immediate).map((item) => item.transport);
    this.batchedTransports = transports.filter((item) => !item.immediate).map((item) => item.transport);
    this.batchOptions = normalizeBatchOptions(batchOptions);
    this.stats = {
      queued: 0,
      written: 0,
      dropped: 0,
      failed: 0,
      queueLength: 0,
      closed: false,
      transports: transports.map((item) => item.transport.name),
    };
  }

  getContext(): BrowserTransportContext {
    return {
      runtime: "browser",
      transports: this.stats.transports.slice(),
    };
  }

  write(entry: LogEntry): void {
    if (this.closed) {
      this.stats.dropped += 1;
      return;
    }

    let wroteImmediate = false;
    for (const transport of this.immediateTransports) {
      try {
        const result = transport.write([entry], this.getContext());
        if (result && typeof (result as Promise<void>).catch === "function") {
          void (result as Promise<void>).catch(() => {
            this.stats.failed += 1;
          });
        }
        wroteImmediate = true;
      } catch {
        this.stats.failed += 1;
      }
    }

    if (wroteImmediate) this.stats.written += 1;
    if (!this.batchedTransports.length) return;

    if (this.queue.length >= this.batchOptions.maxQueue) {
      if (this.batchOptions.overflow === "throw") throw new Error("browser-log-queue-full");
      if (this.batchOptions.overflow === "drop-oldest") this.queue.shift();
      this.stats.dropped += 1;
      if (this.batchOptions.overflow === "drop-newest") return;
    }

    this.queue.push(entry);
    this.stats.queued += 1;
    this.stats.queueLength = this.queue.length;

    if (this.queue.length >= this.batchOptions.size) {
      void this.flushQueue();
      return;
    }

    this.ensureTimer();
  }

  async flush(): Promise<void> {
    this.clearTimer();
    await this.flushQueue();

    for (const transport of [...this.immediateTransports, ...this.batchedTransports]) {
      if (typeof transport.flush !== "function") continue;
      try {
        await transport.flush();
      } catch {
        this.stats.failed += Math.max(1, this.queue.length);
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stats.closed = true;
    this.clearTimer();
    await this.flush();

    for (const transport of [...this.immediateTransports, ...this.batchedTransports]) {
      if (typeof transport.close !== "function") continue;
      try {
        await transport.close();
      } catch {
        this.stats.failed += 1;
      }
    }
  }

  getStats(): BrowserLogStats {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      closed: this.closed,
      transports: this.stats.transports.slice(),
    };
  }

  private ensureTimer(): void {
    if (this.timer || this.closed || this.batchOptions.delayMs <= 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushQueue();
    }, this.batchOptions.delayMs);
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private async flushQueue(): Promise<void> {
    if (!this.batchedTransports.length || this.queue.length === 0) return;
    if (this.flushing) {
      await this.flushing;
      if (this.queue.length > 0) await this.flushQueue();
      return;
    }

    this.flushing = (async () => {
      while (this.queue.length > 0) {
        const entries = this.queue.splice(0, this.queue.length);
        this.stats.queueLength = this.queue.length;
        let failed = false;

        for (const transport of this.batchedTransports) {
          try {
            await transport.write(entries, this.getContext());
          } catch {
            failed = true;
          }
        }

        if (failed) this.stats.failed += entries.length;
        else if (this.immediateTransports.length === 0) this.stats.written += entries.length;
      }
    })().finally(() => {
      this.flushing = null;
      this.stats.queueLength = this.queue.length;
    });

    await this.flushing;
  }
}

function createBrowserLog(options: BrowserLogOptions = {}): BrowserLogInstance {
  const cfg = options && typeof options === "object" ? options : {};
  const levels = normalizeLevels(cfg.levels);
  const timeZone = normalizeTimeZone(cfg.timeZone);
  const transports = resolveTransports(cfg, levels, timeZone);
  const manager = new BrowserTransportManager(transports, cfg.batch);

  const { api } = createCommonLogger<BrowserLogStats>({
    levels,
    minLevel: cfg.minLevel,
    defaultSource: toString(cfg.source) || "browser",
    defaultGroup: toString(cfg.group) || undefined,
    defaultMetadata: asObject(cfg.metadata),
    serializers: cfg.serializers,
    redact: cfg.redact,
    sample: cfg.sample,
    writeEntry(entry) {
      manager.write(entry);
      try {
        logStream.emit("log", entry, manager.getContext());
      } catch {}
    },
    flush() {
      return manager.flush();
    },
    close() {
      return manager.close();
    },
    getStats() {
      return manager.getStats();
    },
  });

  return api as BrowserLogInstance;
}

export { createBrowserLog };
