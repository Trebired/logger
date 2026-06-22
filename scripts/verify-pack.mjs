import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { RELEASE_NATIVE_TARGETS, expectedHostBinaryName, nativeBinaryNameForTarget } from "./native-targets.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(rootDir, ".tmp", "verify-pack");
const npmCacheDir = path.join(tempRoot, "npm-cache");
const packageJsonBackupPath = path.join(rootDir, ".tmp", "package.json.backup");
const nodeTypesDir = path.join(rootDir, "node_modules", "@types", "node");
const tscBin = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");

async function main() {
  await resetTempRoot();

  const tarballPath = packPackage();
  const tarballEntries = listTarEntries(tarballPath);
  const packedPackageJson = readPackedPackageJson(tarballPath);

  validatePackedEntrypoints(packedPackageJson, tarballEntries);
  validatePackedImports(packedPackageJson, tarballEntries);
  validateNativeEntries(tarballEntries, resolveNativeScope());
  await runConsumerSmokeTest(tarballPath);

  console.log("Pack verification succeeded.");
}

async function resetTempRoot() {
  await fs.rm(tempRoot, {
    force: true,
    recursive: true,
  });
  await fs.mkdir(tempRoot, {
    recursive: true,
  });
  await fs.mkdir(npmCacheDir, {
    recursive: true,
  });
}

function packPackage() {
  const stdoutPath = path.join(tempRoot, "pack-output.json");

  try {
    execFileSync("sh", [
      "-lc",
      `npm pack --json > ${shellEscape(stdoutPath)}`,
    ], {
      ...createNpmOptions(rootDir),
      stdio: ["ignore", "inherit", "inherit"],
    });
  }
  catch (error) {
    restorePackageJsonFromBackup();
    throw error;
  }

  const stdout = execFileSync("cat", [stdoutPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [entry] = JSON.parse(stdout);

  if (!entry?.filename) {
    throw new Error("npm pack did not return a tarball filename.");
  }

  return path.join(rootDir, entry.filename);
}

function listTarEntries(tarballPath) {
  const stdout = execFileSync("tar", ["-tf", tarballPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  return new Set(stdout
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean));
}

function readPackedPackageJson(tarballPath) {
  const stdout = execFileSync("tar", ["-xOf", tarballPath, "package/package.json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  return JSON.parse(stdout);
}

function validatePackedEntrypoints(packageJson, tarballEntries) {
  const targets = collectEntrypointTargets(packageJson);

  for (const target of targets) {
    assertTarEntryExists(tarballEntries, target, `Missing packed entrypoint target: ${target}`);
  }
}

function collectEntrypointTargets(packageJson) {
  const targets = new Set();

  addTarget(targets, packageJson.main);
  addTarget(targets, packageJson.types);

  for (const value of Object.values(packageJson.exports || {})) {
    collectExportTargets(value, targets);
  }

  return targets;
}

function collectExportTargets(value, targets) {
  if (!value) {
    return;
  }

  if (typeof value === "string") {
    addTarget(targets, value);
    return;
  }

  for (const nested of Object.values(value)) {
    collectExportTargets(nested, targets);
  }
}

function addTarget(targets, value) {
  if (typeof value !== "string" || value.length === 0) {
    return;
  }

  targets.add(value);
}

function validatePackedImports(packageJson, tarballEntries) {
  for (const [alias, target] of Object.entries(packageJson.imports || {})) {
    if (typeof target !== "string") {
      continue;
    }

    if (target.includes("./src/") || target.includes("./internal/")) {
      throw new Error(`Packed imports entry ${alias} still points at source path ${target}.`);
    }

    assertTarEntryExists(tarballEntries, target, `Packed imports target is missing for ${alias}: ${target}`);
  }
}

function validateNativeEntries(tarballEntries, scope) {
  const expected = expectedNativePackPaths(scope);

  for (const nativePath of expected) {
    assertTarEntryExists(tarballEntries, nativePath, `Missing packed native binary: ${nativePath}`);
  }
}

function expectedNativePackPaths(scope) {
  if (scope === "matrix") {
    return RELEASE_NATIVE_TARGETS.map((target) => `./native/${nativeBinaryNameForTarget(target)}`);
  }

  if (scope === "host") {
    const hostBinary = expectedHostBinaryName();
    return hostBinary ? [`./native/${hostBinary}`] : [];
  }

  return [];
}

function resolveNativeScope() {
  return process.env.TB_LOGGER_VERIFY_NATIVE_SCOPE === "matrix"
    ? "matrix"
    : "host";
}

function assertTarEntryExists(tarballEntries, packagePath, message) {
  const normalized = normalizePackagePath(packagePath);

  if (!tarballEntries.has(normalized)) {
    throw new Error(message);
  }
}

function normalizePackagePath(packagePath) {
  return `package/${String(packagePath).replace(/^\.\//u, "")}`;
}

async function runConsumerSmokeTest(tarballPath) {
  const consumerDir = path.join(tempRoot, "consumer");

  await fs.mkdir(consumerDir, {
    recursive: true,
  });

  await fs.writeFile(path.join(consumerDir, "package.json"), JSON.stringify({
    name: "logger-pack-smoke",
    private: true,
    type: "module",
    dependencies: {
      "@trebired/logger": `file:${tarballPath}`,
    },
    devDependencies: {
      "@types/node": `file:${nodeTypesDir}`,
    },
  }, null, 2));

  await fs.writeFile(path.join(consumerDir, "index.ts"), [
    'import { createLog } from "@trebired/logger";',
    'import { createBrowserLog } from "@trebired/logger/browser";',
    "",
    "const serverLog = createLog;",
    "const browserLog = createBrowserLog;",
    "",
    "console.log(Boolean(serverLog), Boolean(browserLog));",
  ].join("\n"));

  await fs.writeFile(path.join(consumerDir, "runtime-main.ts"), [
    'import * as mod from "@trebired/logger";',
    "",
    "console.log(typeof mod.createLog, Object.keys(mod).length > 0);",
  ].join("\n"));

  await fs.writeFile(path.join(consumerDir, "runtime-browser.ts"), [
    'import * as mod from "@trebired/logger/browser";',
    "",
    "console.log(typeof mod.createBrowserLog, Object.keys(mod).length > 0);",
  ].join("\n"));

  await fs.writeFile(path.join(consumerDir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      lib: [
        "ES2020",
      ],
      module: "ESNext",
      moduleResolution: "Bundler",
      noEmit: true,
      target: "ES2020",
      types: [
        "node",
      ],
    },
    include: [
      "./index.ts",
    ],
  }, null, 2));

  execFileSync("npm", ["install", "--ignore-scripts"], {
    ...createNpmOptions(consumerDir),
    stdio: "inherit",
  });

  execFileSync(process.execPath, [tscBin, "-p", "tsconfig.json"], {
    cwd: consumerDir,
    stdio: "inherit",
  });

  execFileSync("bun", ["runtime-main.ts"], {
    cwd: consumerDir,
    stdio: "inherit",
  });

  execFileSync("bun", ["runtime-browser.ts"], {
    cwd: consumerDir,
    stdio: "inherit",
  });
}

function createNpmOptions(cwd) {
  return {
    cwd,
    env: {
      ...process.env,
      npm_config_cache: npmCacheDir,
    },
  };
}

function shellEscape(value) {
  return `'${String(value).replace(/'/gu, `'\\''`)}'`;
}

function restorePackageJsonFromBackup() {
  execFileSync(process.execPath, [
    "-e",
    [
      "const fs = require('fs');",
      `const backup = ${JSON.stringify(packageJsonBackupPath)};`,
      `const target = ${JSON.stringify(path.join(rootDir, "package.json"))};`,
      "if (fs.existsSync(backup)) {",
      "  fs.copyFileSync(backup, target);",
      "}",
    ].join(" "),
  ], {
    stdio: "inherit",
  });
}

await main();
