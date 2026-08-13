import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function filePathFromStackLine(line: string): string {
  const fileUrlMatch = line.match(/file:\/\/[^:)]+/u);
  if (fileUrlMatch) return fileURLToPath(fileUrlMatch[0]);

  const absolutePathMatch = line.match(/(?:\(|\s)(\/[^:)]+)(?::\d+)?(?::\d+)?\)?$/u);
  return absolutePathMatch ? absolutePathMatch[1] : "";
}

function findPackageRoot(startPath: string): string {
  let current = fs.existsSync(startPath) && fs.statSync(startPath).isDirectory()
  ? startPath
  : path.dirname(startPath);

  for (;; ) {
    if (fs.existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}

const LOGGER_PACKAGE_ROOT = findPackageRoot(fileURLToPath(import.meta.url));

function isLoggerInternalFile(filePath: string): boolean {
  return Boolean(
    LOGGER_PACKAGE_ROOT &&
      (filePath === LOGGER_PACKAGE_ROOT ||
        filePath.startsWith(`${LOGGER_PACKAGE_ROOT}${path.sep}`)),
  );
}

function resolveCallerConfigStart(): string {
  const stack = new Error().stack || "";
  for (const line of stack.split("\n")) {
    const filePath = filePathFromStackLine(line);
    if (!filePath || isLoggerInternalFile(filePath)) continue;

    return findPackageRoot(filePath) || path.dirname(filePath);
  }

  return process.cwd();
}

export { resolveCallerConfigStart };
