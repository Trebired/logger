import { Database } from "bun:sqlite";

type CheckpointMode = "PASSIVE" | "TRUNCATE";

type WorkerRequest =
| {
  type: "open";
  file: string;
}
| {
  type: "checkpoint";
  file: string;
  mode: CheckpointMode;
  id?: number;
}
| {
  type: "snapshot";
  file: string;
  id: number;
  outputPath: string;
}
| {
  type: "close";
  file: string;
}
| {
  type: "shutdown";
};

declare const self: Worker;

const databases = new Map<string, Database>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reply(id: number | undefined, error?: string): void {
  if (id == null) return;
  self.postMessage(error ? { type: "done", id, error } : { type: "done", id });
}

function openDatabase(file: string): Database {
  const existing = databases.get(file);
  if (existing) return existing;
  const db = new Database(file, { strict: true });
  db.exec("PRAGMA busy_timeout = 0");
  databases.set(file, db);
  return db;
}

function closeDatabase(file: string): void {
  const db = databases.get(file);
  if (!db) return;
  databases.delete(file);
  try {
    db.close();
  } catch {}
}

function runTask(file: string, id: number | undefined, task: (database: Database) => void): void {
  try {
    task(openDatabase(file));
    reply(id);
  } catch (error) {
    reply(id, errorMessage(error));
  }
}

function shutdown(): void {
  for (const file of Array.from(databases.keys())) closeDatabase(file);
  self.postMessage({ type: "closed" });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "open") openDatabase(request.file);
  if (request.type === "checkpoint") {
    runTask(request.file, request.id, (database) => database.query(`PRAGMA wal_checkpoint(${request.mode})`).all());
  }
  if (request.type === "snapshot") {
    runTask(request.file, request.id, (database) => database.query("VACUUM INTO ?").run(request.outputPath));
  }
  if (request.type === "close") closeDatabase(request.file);
  if (request.type === "shutdown") shutdown();
};
