import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function cleanSegment(value) {
  return value
  .trim()
  .split("")
  .map((char) => {
      const code = char.charCodeAt(0);
      const isLower = code >= 97 && code <= 122;
      const isUpper = code >= 65 && code <= 90;
      const isDigit = code >= 48 && code <= 57;
      const isSeparator = char === "." || char === "_" || char === "-";

      return isLower || isUpper || isDigit || isSeparator ? char : "-";
  })
  .join("");
}

function readPackageMetadata() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
    const packageName = typeof packageJson.name === "string" && packageJson.name.trim()
    ? packageJson.name.trim()
    : "@package/logger";
    const organizationName = typeof packageJson.config?.organization?.name === "string"
    ? packageJson.config.organization.name.trim()
    : "";
    const scopeSlashIndex = packageName.startsWith("@") ? packageName.indexOf("/") : -1;
    const packageSlugValue = scopeSlashIndex > 0 ? packageName.slice(scopeSlashIndex + 1) : packageName;
    const organizationValue = organizationName || (scopeSlashIndex > 0 ? packageName.slice(1, scopeSlashIndex) : "");

    return {
      group: [cleanSegment(organizationValue), cleanSegment(packageSlugValue)].filter(Boolean).join("."),
    };
  } catch {
    const fallback = cleanSegment(process.env.npm_package_name || "logger");
    const slashIndex = fallback.startsWith("@") ? fallback.indexOf("/") : -1;
    return {
      group: slashIndex > 0 ? fallback.slice(slashIndex + 1) : fallback,
    };
  }
}

const packageMetadata = readPackageMetadata();
const logPrefix = `[${packageMetadata.group}]`;

function runVerify(scope) {
  const result = spawnSync("node", ["./scripts/verify/pack.mjs"], {
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
  console.warn(`${logPrefix} host-only publish override enabled; packed tarball will only be verified for the current machine's native binary.`);
  runVerify("host");
} else {
  console.log(`${logPrefix} verifying full native release matrix before publish.`);
  runVerify("matrix");
}
