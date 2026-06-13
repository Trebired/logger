import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { createLog, getLogsForDir, logStream } from "../../src/index";
import { activeStorageBackendNotice } from "../../src/storage/backend/index";
import { resetCreateLogStateForTests } from "../../src/core/create_log";
import { captureStderr, captureStdout, tempDir } from "./helpers";

function withWorkingDir<T>(nextDir: string, fn: () => T): T {
  const previousDir = process.cwd();
  process.chdir(nextDir);
  try {
    return fn();
  } finally {
    process.chdir(previousDir);
  }
}

describe("console visibility config", () => {
  test("hides configured groups from console while still saving and streaming logs", async () => {
    const projectRoot = tempDir("project_");
    const nestedDir = path.join(projectRoot, "apps", "web");
    const logDir = tempDir("logs_");
    const configPath = path.join(projectRoot, "tb.logger.json");
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify({ hideConsoleGroups: ["blog.post"] }, null, 2)}\n`, "utf8");

    const streamedGroups: string[] = [];
    const handler = (entry: { group: string }) => streamedGroups.push(entry.group);
    logStream.on("log", handler);

    let log: ReturnType<typeof createLog> | null = null;
    try {
      const output = withWorkingDir(nestedDir, () =>
        captureStdout(() => {
          const createdLog = createLog({
            dir: logDir,
            quiet: true,
            console: { colors: false, timestamp: false, metadata: false },
            write: { mode: "sync" },
          });
          log = createdLog;

          createdLog.info("blog.post", "root hidden");
          createdLog.info("blog.post.comment", "child hidden");
          createdLog.info("blog.other", "visible sibling");
        }));

      expect(output).not.toContain("root hidden");
      expect(output).not.toContain("child hidden");
      expect(output).toContain("visible sibling");
      expect(streamedGroups).toEqual(["blog.post", "blog.post.comment", "blog.other"]);

      const stored = await getLogsForDir(logDir, { groupKey: "all", level: "all", limit: 10 });
      expect(stored.logs.filter((row) => row.group.startsWith("blog.post")).map((row) => row.message)).toEqual(["root hidden", "child hidden"]);
    } finally {
      logStream.off("log", handler);
      await log?.close();
    }
  });

  test("warns and ignores invalid tb.logger.json files", async () => {
    const projectRoot = tempDir("project_");
    const nestedDir = path.join(projectRoot, "workspace");
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "tb.logger.json"), `${JSON.stringify({ hideConsoleGroups: "blog.post" })}\n`, "utf8");

    let log: ReturnType<typeof createLog> | null = null;
    let output = "";
    const warning = withWorkingDir(nestedDir, () =>
      captureStderr(() => {
        output = captureStdout(() => {
          const createdLog = createLog({
            save: false,
            quiet: true,
            console: { colors: false, timestamp: false, metadata: false },
          });
          log = createdLog;
          createdLog.info("blog.post", "still visible");
        });
      }));

    expect(warning).toContain("invalid tb.logger.json");
    expect(output).toContain("still visible");
    await log?.close();
  });

  test("keeps package startup notices visible even when logger.initialize is hidden", async () => {
    const projectRoot = tempDir("project_");
    const nestedDir = path.join(projectRoot, "workspace");
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "tb.logger.json"), `${JSON.stringify({ hideConsoleGroups: ["logger.initialize"] }, null, 2)}\n`, "utf8");

    resetCreateLogStateForTests();

    let log: ReturnType<typeof createLog> | null = null;
    const output = withWorkingDir(nestedDir, () =>
      captureStdout(() => {
        const createdLog = createLog({
          save: false,
          console: { colors: false, timestamp: false, metadata: false },
        });
        log = createdLog;
        createdLog.info("logger.initialize", "user hidden");
      }));

    expect(output).toContain("@trebired/logger initialized");
    expect(output).toContain(activeStorageBackendNotice());
    expect(output).not.toContain("user hidden");
    await log?.close();
  });
});
