import { spawnSync } from "node:child_process";

import { RELEASE_NATIVE_TARGETS, expectedHostBinaryName, nativeBinaryNameForTarget } from "./native-targets.mjs";

function packedPaths() {
  const result = spawnSync("npm", ["pack", "--json", "--dry-run"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  if (result.status !== 0) process.exit(result.status || 1);
  const parsed = JSON.parse(String(result.stdout || "[]"));
  const files = Array.isArray(parsed) && parsed[0] && Array.isArray(parsed[0].files) ? parsed[0].files : [];
  return new Set(files.map((item) => String(item.path || "")));
}

function expectPaths(paths, required, label) {
  const missing = required.filter((item) => !paths.has(item));
  if (missing.length) {
    throw new Error(`pack-missing-${label}: ${missing.join(", ")}`);
  }
}

function expectedNativePackPaths(scope) {
  if (scope === "matrix") {
    return RELEASE_NATIVE_TARGETS.map((target) => `native/${nativeBinaryNameForTarget(target)}`);
  }

  if (scope === "host") {
    const hostBinary = expectedHostBinaryName();
    return hostBinary ? [`native/${hostBinary}`] : [];
  }

  return [];
}

function main() {
  const scope = process.env.TB_LOGGER_VERIFY_NATIVE_SCOPE || "host";
  const paths = packedPaths();

  expectPaths(paths, ["package.json"], "package");

  const hasDist = Array.from(paths).some((item) => item.startsWith("dist/"));
  if (!hasDist) throw new Error("pack-missing-dist-output");

  const expectedNative = expectedNativePackPaths(scope);
  expectPaths(paths, expectedNative, "native");

  const nativeCount = Array.from(paths).filter((item) => item.startsWith("native/") && item.endsWith(".node")).length;
  console.log(`pack verified: dist present, native files packed: ${nativeCount}, scope: ${scope}`);
}

main();
