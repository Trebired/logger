import { spawnSync } from "node:child_process";

for (const script of ["./scripts/verify/guard.mjs", "./scripts/verify/pack.mjs"]) {
  const result = spawnSync(process.execPath, [script], { cwd: process.cwd(), stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
