import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const loggerVersion = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8")).version;

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
  await writeConsumerBrowserRuntime(consumerDir);
}

async function writeConsumerLoggerConfig(consumerDir) {
  await fs.mkdir(path.join(consumerDir, ".trebired", "logger"), {
      recursive: true,
  });
  await fs.writeFile(path.join(consumerDir, ".trebired", "logger", "config.ts"), [
      "export default {",
      `  forVersion: '${loggerVersion}',`,
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
      `const loggerConfig = defineConfig({ forVersion: '${loggerVersion}', defaults: { minLevel: 'warn' } });`,
      "console.log(Boolean(serverLog), Boolean(browserLog), loggerConfig.defaults?.minLevel);",
    ].join("\n"));
}

async function writeConsumerMainRuntime(consumerDir) {
  await fs.writeFile(path.join(consumerDir, "runtime-main.ts"), [
      'import fs from "node:fs";',
      'import * as mod from "@package/logger";',
      'import { loadConfigSync } from "@package/logger/config";',
      "",
      "const loaded = loadConfigSync(process.cwd());",
      "if (loaded.config.defaults.minLevel !== 'error') throw new Error('config was not loaded');",
      "if (loaded.config.prefix !== 'consumer') throw new Error('config prefix was not loaded');",
      "const log = mod.createLog({ dir: './logs', source: 'consumer' });",
      "log.info('runtime.test', 'skip');",
      "log.error('runtime.test', 'keep');",
      "const result = await log.queryLogs({ count: true });",
      "if (!fs.existsSync('./logs/logs.db')) throw new Error('log store was not created');",
      "if (result.total !== 1 || result.entries[0]?.message !== 'keep') throw new Error('config defaults were not applied');",
      "const entry = result.entries[0];",
      "if (entry.group !== 'consumer.runtime.test') throw new Error(`config prefix was not applied: ${entry.group}`);",
      "await log.close();",
      "const fixture = await import('@fixture/package-logger-user');",
      "await fixture.runPackageLogger();",
      "const packageResult = await mod.queryLogs('./package-logs', { search: 'package keep' });",
      "const packageEntry = packageResult.entries[0];",
      "if (packageEntry?.group !== 'trebired.bundler.build') throw new Error(`package config prefix was not applied: ${packageEntry?.group}`);",
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
      `  forVersion: '${loggerVersion}',`,
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
      "  await log.close();",
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

function runConsumerRuntimes(consumerDir) {
  for (const file of ["runtime-main.ts", "runtime-browser.ts"]) {
    execFileSync("bun", [file], {
        cwd: consumerDir,
        stdio: "inherit",
    });
  }
}

export {
  runConsumerRuntimes,
  writeConsumerPackageJson,
  writeConsumerPackageLoggerFixture,
  writeConsumerSourceFiles,
  writeConsumerTsconfig,
};
