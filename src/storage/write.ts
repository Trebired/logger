import fs from "node:fs";
import path from "node:path";

import { normGroup } from "#8xmnu037caa7";
import type { LogEntry, LogStats, NormalizedRetentionOptions, NormalizedWriteOptions } from "#tvzweoxg5ahk";
import { toString } from "#ycytzc4gr3f7";
import { cleanupLogs } from "./retention.js";
import { fileStampForEntry, makeLogFileName } from "./names.js";
import { touchPartitionMarkerSync } from "./partitions.js";

type WriterOptions = {
  dir: string;
  save: boolean;
  write: NormalizedWriteOptions;
  retention: NormalizedRetentionOptions;
  timeZone: string;
  onError?: (message: string) => void;
};

class FileWriter {
  private dir: string;
  private save: boolean;
  private writeOptions: NormalizedWriteOptions;
  private retention: NormalizedRetentionOptions;
  private timeZone: string;
  private queue: LogEntry[] = [];
  private processing = false;
  private waiters: Array<() => void> = [];
  private closed = false;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private onError?: (message: string) => void;
  private stats: LogStats;

  constructor(options: WriterOptions) {
    this.dir = toString(options.dir);
    this.save = Boolean(options.save);
    this.writeOptions = options.write;
    this.retention = options.retention;
    this.timeZone = toString(options.timeZone);
    this.onError = options.onError;
    this.stats = {
      mode: this.writeOptions.mode,
      queued: 0,
      written: 0,
      dropped: 0,
      failed: 0,
      queueLength: 0,
      closed: false,
    };

    this.startCleanup();
  }

  setDir(nextDir: string): void {
    this.dir = toString(nextDir);
    if (this.dir) this.save = true;
    this.startCleanup();
  }

  getDir(): string {
    return this.dir;
  }

  isSavingEnabled(): boolean {
    return this.save;
  }

  getStats(): LogStats {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      closed: this.closed,
    };
  }

  write(entry: LogEntry): void {
    if (!this.save) return;
    if (!this.dir) {
      this.fail("missing dir, saving disabled");
      return;
    }
    if (this.closed) {
      this.stats.dropped += 1;
      return;
    }

    if (this.writeOptions.mode === "sync") {
      try {
        this.writeNowSync(entry);
        this.stats.written += 1;
      } catch (error) {
        this.stats.failed += 1;
        this.fail(`save failed for ${entry.group}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }

    if (this.queue.length >= this.writeOptions.maxQueue) {
      if (this.writeOptions.overflow === "throw") throw new Error("logger-write-queue-full");
      if (this.writeOptions.overflow === "drop-oldest") this.queue.shift();
      this.stats.dropped += 1;
      if (this.writeOptions.overflow === "drop-newest") return;
    }

    this.queue.push(entry);
    this.stats.queued += 1;
    this.stats.queueLength = this.queue.length;
    this.processQueue();
  }

  async flush(): Promise<void> {
    if (!this.processing && this.queue.length === 0) return;
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      this.processQueue();
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    await this.flush();
  }

  private startCleanup(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    if (!this.save || !this.dir || !this.retention.enabled) return;
    if (this.retention.maxAgeDays == null && this.retention.maxPartitions == null && !this.retention.compressOldFiles) return;

    cleanupLogs(this.dir, this.retention).catch(() => {});
    this.cleanupTimer = setInterval(() => {
      cleanupLogs(this.dir, this.retention).catch(() => {});
    }, this.retention.cleanupIntervalMs);

    if (typeof this.cleanupTimer.unref === "function") this.cleanupTimer.unref();
  }

  private processQueue(): void {
    if (this.processing || this.writeOptions.mode !== "async") return;
    this.processing = true;

    queueMicrotask(async () => {
      while (this.queue.length) {
        const entry = this.queue.shift() as LogEntry;
        try {
          await this.writeNow(entry);
          this.stats.written += 1;
        } catch (error) {
          this.stats.failed += 1;
          this.fail(`save failed for ${entry.group}: ${error instanceof Error ? error.message : String(error)}`);
        }
        this.stats.queueLength = this.queue.length;
      }

      this.processing = false;
      const waiters = this.waiters.splice(0);
      for (const resolve of waiters) resolve();
    });
  }

  private fail(message: string): void {
    if (typeof this.onError === "function") this.onError(`[trebired.logger] ${message}`);
  }

  private resolvePath(entry: LogEntry): string {
    const normalized = normGroup(entry.group);
    const partition = toString(entry.partition);
    const groupDir = partition
      ? path.join(this.dir, partition, ...normalized.parts)
      : path.join(this.dir, ...normalized.parts);
    if (partition) touchPartitionMarkerSync(this.dir, partition);
    fs.mkdirSync(groupDir, { recursive: true });
    const stamp = fileStampForEntry(entry, this.timeZone);

    let sequence = 1;
    for (;;) {
      const filePath = path.join(groupDir, makeLogFileName(stamp, sequence, entry.level));
      try {
        const stat = fs.statSync(filePath);
        if (stat.size < this.retention.maxFileSize) return filePath;
      } catch {
        return filePath;
      }
      sequence += 1;
    }
  }

  private async writeNow(entry: LogEntry): Promise<void> {
    const filePath = this.resolvePath(entry);
    await fs.promises.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  private writeNowSync(entry: LogEntry): void {
    const filePath = this.resolvePath(entry);
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }
}

export { FileWriter };
