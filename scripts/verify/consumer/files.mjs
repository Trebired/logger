import fs from "node:fs/promises";
import path from "node:path";

import { writeConsumerNodeRuntime } from "./node-runtime.mjs";

async function writeConsumerPackageJson(consumerDir, tarballPath, nodeTypesDir) {
  await fs.writeFile(path.join(consumerDir, "package.json"), JSON.stringify({
        name: "logger-pack-smoke",
        private: true,
        type: "module",
        dependencies: {
          "@package/logger": `file:${tarballPath}`,
        },
        devDependencies: {
          "@types/node": `file:${nodeTypesDir}`,
        },
      }, null, 2));
}

async function writeConsumerSourceFiles(consumerDir) {
  await writeConsumerLoggerConfig(consumerDir);
  await writeConsumerTypeSource(consumerDir);
  await writeConsumerMainRuntime(consumerDir);
  await writeConsumerNodeRuntime(consumerDir);
  await writeConsumerBrowserRuntime(consumerDir);
}

async function writeConsumerLoggerConfig(consumerDir) {
  await fs.mkdir(path.join(consumerDir, ".trebired", "logger"), {
      recursive: true,
  });
  await fs.writeFile(path.join(consumerDir, ".trebired", "logger", "config.ts"), [
      "export default {",
      "  prefix: 'consumer',",
      "  defaults: {",
      "    console: false,",
      "    minLevel: 'error',",
      "  },",
      "};",
      "",
    ].join("\n"));
}

async function writeConsumerTypeSource(consumerDir) {
  await fs.writeFile(path.join(consumerDir, "index.ts"), [
      'import { createLog } from "@package/logger";',
      'import { defineConfig } from "@package/logger/config";',
      'import { createBrowserLog } from "@package/logger/browser";',
      "",
      "const serverLog = createLog;",
      "const browserLog = createBrowserLog;",
      "const loggerConfig = defineConfig({ defaults: { minLevel: 'warn' } });",
      "console.log(Boolean(serverLog), Boolean(browserLog), loggerConfig.defaults?.minLevel);",
    ].join("\n"));
}

async function writeConsumerMainRuntime(consumerDir) {
  await fs.writeFile(path.join(consumerDir, "runtime-main.ts"), [
      'import fs from "node:fs/promises";',
      'import * as mod from "@package/logger";',
      'import { loadConfigSync } from "@package/logger/config";',
      "",
      "const loaded = loadConfigSync(process.cwd());",
      "if (loaded.config.defaults.minLevel !== 'error') throw new Error('config was not loaded');",
      "if (loaded.config.prefix !== 'consumer') throw new Error('config prefix was not loaded');",
      "const log = mod.createLog({ dir: './logs', source: 'consumer' });",
      "log.info('runtime.test', 'skip');",
      "log.error('runtime.test', 'keep');",
      "await log.flush();",
      "const files = await Array.fromAsync((async function* walk(dir) {",
      "  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {",
      "    const filePath = `${dir}/${entry.name}`;",
      "    if (entry.isDirectory()) yield* walk(filePath);",
      "    else if (entry.isFile() && filePath.endsWith('.jsonl')) yield filePath;",
      "  }",
      "})('./logs'));",
      "const lines = (await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).join('').trim().split('\\n').filter(Boolean);",
      "if (lines.length !== 1 || !lines[0].includes('keep')) throw new Error('config defaults were not applied');",
      "const entry = JSON.parse(lines[0]);",
      "if (entry.group !== 'consumer.runtime.test') throw new Error(`config prefix was not applied: ${entry.group}`);",
      "const fixture = await import('@fixture/package-logger-user');",
      "await fixture.runPackageLogger();",
      "const packageFiles = await Array.fromAsync((async function* walk(dir) {",
      "  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {",
      "    const filePath = `${dir}/${entry.name}`;",
      "    if (entry.isDirectory()) yield* walk(filePath);",
      "    else if (entry.isFile() && filePath.endsWith('.jsonl')) yield filePath;",
      "  }",
      "})('./package-logs'));",
      "const packageLines = (await Promise.all(packageFiles.map((file) => fs.readFile(file, 'utf8')))).join('').trim().split('\\n').filter(Boolean);",
      "const packageEntry = JSON.parse(packageLines.find((line) => line.includes('package keep')) || '{}');",
      "if (packageEntry.group !== 'trebired.bundler.build') throw new Error(`package config prefix was not applied: ${packageEntry.group}`);",
      "console.log(typeof mod.createLog, Object.keys(mod).length > 0);",
    ].join("\n"));
}

async function writeConsumerPackageLoggerFixture(consumerDir) {
  const fixtureDir = path.join(
    consumerDir,
    "node_modules",
    "@fixture",
    "package-logger-user",
  );

  await fs.mkdir(path.join(fixtureDir, ".trebired", "logger"), {
      recursive: true,
  });
  await fs.writeFile(path.join(fixtureDir, "package.json"), JSON.stringify({
        name: "@fixture/package-logger-user",
        type: "module",
        exports: "./index.mjs",
      }, null, 2));
  await fs.writeFile(path.join(fixtureDir, ".trebired", "logger", "config.ts"), [
      "export default {",
      "  prefix: 'trebired',",
      "  defaults: {",
      "    console: false,",
      "    minLevel: 'error',",
      "  },",
      "};",
      "",
    ].join("\n"));
  await fs.writeFile(path.join(fixtureDir, "index.mjs"), [
      'import { createLog } from "@package/logger";',
      "",
      "export async function runPackageLogger() {",
      "  const log = createLog({ dir: './package-logs', source: 'fixture' });",
      "  log.error('bundler.build', 'package keep');",
      "  await log.flush();",
      "}",
      "",
    ].join("\n"));
}

async function writeConsumerBrowserRuntime(consumerDir) {
  await fs.writeFile(path.join(consumerDir, "runtime-browser.ts"), [
      'import * as mod from "@package/logger/browser";',
      "",
      "const packageEntries = [];",
      "const capture = { name: 'capture', write(entries) { packageEntries.push(...entries); } };",
      "const packageLog = mod.createBrowserLog({",
      "  console: false,",
      "  source: '@trebired/frontend',",
      "  transports: [capture],",
      "});",
      "packageLog.info('logger', 'Frontend logger initialized');",
      "await packageLog.flush();",
      "if (packageEntries[0]?.group !== 'trebired.frontend.logger') {",
      "  throw new Error(`browser package prefix was not applied: ${packageEntries[0]?.group}`);",
      "}",
      "const appEntries = [];",
      "const appCapture = { name: 'capture', write(entries) { appEntries.push(...entries); } };",
      "const appLog = mod.createBrowserLog({",
      "  console: false,",
      "  source: 'browser',",
      "  transports: [appCapture],",
      "});",
      "appLog.info('runtime', 'bound');",
      "await appLog.flush();",
      "if (appEntries[0]?.group !== 'runtime') {",
      "  throw new Error(`unscoped browser prefix changed: ${appEntries[0]?.group}`);",
      "}",
      "console.log(typeof mod.createBrowserLog, Object.keys(mod).length > 0);",
    ].join("\n"));
}

async function writeConsumerTsconfig(consumerDir) {
  await fs.writeFile(path.join(consumerDir, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          lib: [
            "ES2020",
            "DOM",
          ],
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          strict: true,
          target: "ES2020",
          types: [
            "node",
          ],
        },
        include: [
          "./index.ts",
        ],
      }, null, 2));
}

export {
  writeConsumerPackageJson,
  writeConsumerPackageLoggerFixture,
  writeConsumerSourceFiles,
  writeConsumerTsconfig,
};
