import { spawnSync } from "node:child_process";

function runVerify(scope) {
  const result = spawnSync("node", ["./scripts/verify-pack.mjs"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      TB_LOGGER_VERIFY_NATIVE_SCOPE: scope,
    },
  });

  if (result.status !== 0) process.exit(result.status || 1);
}

if (process.env.TB_LOGGER_ALLOW_HOST_ONLY_PUBLISH === "1") {
  console.warn("[trebired.logger] host-only publish override enabled; packed tarball will only be verified for the current machine's native binary.");
  runVerify("host");
} else {
  console.log("[trebired.logger] verifying full native release matrix before publish.");
  runVerify("matrix");
}
