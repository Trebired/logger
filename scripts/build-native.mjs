import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { nativeBinaryNameForTarget } from "./native-targets.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "native", "logger-native", "Cargo.toml");
const crateRoot = path.dirname(manifestPath);

function parseArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function detectHostTarget() {
  const result = spawnSync("rustc", ["-vV"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) process.exit(result.status || 1);
  const line = String(result.stdout || "")
    .split("\n")
    .find((item) => item.startsWith("host:"));
  const host = line ? line.slice(5).trim() : "";
  if (!host) throw new Error("unable-to-detect-rust-host-target");
  return host;
}

function sharedLibraryNameForTarget(target) {
  if (target.includes("apple-darwin")) return "liblogger_native.dylib";
  return "liblogger_native.so";
}

const requestedTarget = process.env.TREBIRED_LOGGER_NATIVE_TARGET || parseArgValue("--target") || detectHostTarget();
const binaryName = nativeBinaryNameForTarget(requestedTarget);
const targetDir = path.join(crateRoot, "target", requestedTarget, "release");
const result = spawnSync("cargo", ["build", "--release", "--target", requestedTarget, "--manifest-path", manifestPath], {
  cwd: repoRoot,
  stdio: "inherit",
});

if (result.status !== 0) process.exit(result.status || 1);

const builtLibrary = path.join(targetDir, sharedLibraryNameForTarget(requestedTarget));
const targetFile = path.join(repoRoot, "native", binaryName);

fs.mkdirSync(path.dirname(targetFile), { recursive: true });
fs.copyFileSync(builtLibrary, targetFile);
console.log(`native addon ready at ${targetFile}`);
