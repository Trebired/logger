import fs from "node:fs";

const TARGET_BINARY_NAMES = new Map([
  ["x86_64-unknown-linux-gnu", "linux-x64-gnu.node"],
  ["x86_64-unknown-linux-musl", "linux-x64-musl.node"],
  ["aarch64-unknown-linux-gnu", "linux-arm64-gnu.node"],
  ["aarch64-unknown-linux-musl", "linux-arm64-musl.node"],
  ["x86_64-apple-darwin", "darwin-x64.node"],
  ["aarch64-apple-darwin", "darwin-arm64.node"],
]);

const RELEASE_NATIVE_TARGETS = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
];

function linuxLibcVariant() {
  const report = typeof process.report?.getReport === "function" ? process.report.getReport() : null;
  const header = report && typeof report === "object" ? report.header : null;
  if (header && header.glibcVersionRuntime) return "gnu";
  if (fs.existsSync("/etc/alpine-release")) return "musl";
  return "gnu";
}

function expectedHostBinaryName() {
  if (process.platform === "linux") {
    const libc = linuxLibcVariant();
    if (process.arch === "x64") return `linux-x64-${libc}.node`;
    if (process.arch === "arm64") return `linux-arm64-${libc}.node`;
    return "";
  }

  if (process.platform === "darwin") {
    if (process.arch === "x64") return "darwin-x64.node";
    if (process.arch === "arm64") return "darwin-arm64.node";
    return "";
  }

  return "";
}

function nativeBinaryNameForTarget(target) {
  const resolved = TARGET_BINARY_NAMES.get(target);
  if (!resolved) throw new Error(`unsupported-native-target: ${target}`);
  return resolved;
}

export {
  RELEASE_NATIVE_TARGETS,
  TARGET_BINARY_NAMES,
  expectedHostBinaryName,
  nativeBinaryNameForTarget,
};
