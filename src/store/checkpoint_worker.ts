import { Database } from "bun:sqlite";

type CheckpointMode = "PASSIVE" | "TRUNCATE";

type WorkerRequest =
| {
  type: "open";
  file: string;
}
| {
  type: "checkpoint";
  mode: CheckpointMode;
  id?: number;
}
| {
  type: "snapshot";
  id: number;
  outputPath: string;
}
| {
  type: "close";
};

declare const self: Worker;

let db: Database | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reply(id: number | undefined, error?: string): void {
  if (id == null) return;
  self.postMessage(error ? { type: "done", id, error } : { type: "done", id });
}

function runTask(id: number | undefined, task: (database: Database) => void): void {
  if (!db) {
    reply(id, "log-store-worker-not-open");
    return;
  }
  try {
    task(db);
    reply(id);
  } catch (error) {
    reply(id, errorMessage(error));
  }
}

function openDatabase(file: string): void {
  db = new Database(file, { strict: true });
  db.exec("PRAGMA busy_timeout = 0");
}

function closeDatabase(): void {
  if (db) db.close();
  db = null;
  self.postMessage({ type: "closed" });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "open") openDatabase(request.file);
  if (request.type === "checkpoint") {
    runTask(request.id, (database) => database.query(`PRAGMA wal_checkpoint(${request.mode})`).all());
  }
  if (request.type === "snapshot") {
    runTask(request.id, (database) => database.query("VACUUM INTO ?").run(request.outputPath));
  }
  if (request.type === "close") closeDatabase();
};
