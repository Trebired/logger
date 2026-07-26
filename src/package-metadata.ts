import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type PackageJson = {
  config?: {
    organization?: {
      name?: string;
    };
  };
  name?: string;
};

function readPackageJson(): PackageJson {
  const packageJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");

  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJson;
  } catch {
    return {};
  }
}

function cleanSegment(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function packageScope(name: string): string {
  return new RegExp("^@([^/]+)/").exec(name)?.[1] ?? "";
}

function packageSlug(name: string): string {
  return name.replace(new RegExp("^@[^/]+/"), "").trim();
}

const packageJson = readPackageJson();
const PACKAGE_NAME = cleanSegment(packageJson.name) || "@package/logger";
const PACKAGE_ORGANIZATION_NAME = cleanSegment(packageJson.config?.organization?.name) || packageScope(PACKAGE_NAME) || "package";
const PACKAGE_SLUG = packageSlug(PACKAGE_NAME) || "logger";

function buildPackageLogGroup(...parts: string[]): string {
  return [PACKAGE_ORGANIZATION_NAME, PACKAGE_SLUG, ...parts.map((part) => part.trim()).filter(Boolean)].join(".");
}

export {
  buildPackageLogGroup,
  PACKAGE_NAME,
  PACKAGE_ORGANIZATION_NAME,
  PACKAGE_SLUG,
};
