import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultTargets = [
  "x86_64-unknown-linux-gnu",
  "x86_64-unknown-linux-musl",
  "aarch64-unknown-linux-gnu",
  "aarch64-unknown-linux-musl",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
];

const cliTargets = process.argv.slice(2);
const requestedTargets = cliTargets.length
  ? cliTargets
  : (process.env.TREBIRED_LOGGER_NATIVE_TARGETS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

const targets = requestedTargets.length ? requestedTargets : defaultTargets;

for (const target of targets) {
  const result = spawnSync("node", ["./scripts/build-native.mjs", "--target", target], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
