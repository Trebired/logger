import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RELEASE_NATIVE_TARGETS } from "./native-targets.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const cliTargets = process.argv.slice(2);
const requestedTargets = cliTargets.length
  ? cliTargets
  : (process.env.TB_LOGGER_NATIVE_TARGETS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

const targets = requestedTargets.length ? requestedTargets : RELEASE_NATIVE_TARGETS;

for (const target of targets) {
  const result = spawnSync("node", ["./scripts/build-native.mjs", "--target", target], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
