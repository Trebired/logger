import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "native", "logger-native", "Cargo.toml");
const crateRoot = path.dirname(manifestPath);

const TARGET_BINARY_NAMES = new Map([
  ["x86_64-unknown-linux-gnu", "linux-x64-gnu.node"],
  ["x86_64-unknown-linux-musl", "linux-x64-musl.node"],
  ["aarch64-unknown-linux-gnu", "linux-arm64-gnu.node"],
  ["aarch64-unknown-linux-musl", "linux-arm64-musl.node"],
  ["x86_64-apple-darwin", "darwin-x64.node"],
  ["aarch64-apple-darwin", "darwin-arm64.node"],
]);

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

function nativeBinaryNameForTarget(target) {
  const resolved = TARGET_BINARY_NAMES.get(target);
  if (!resolved) throw new Error(`unsupported-native-target: ${target}`);
  return resolved;
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
