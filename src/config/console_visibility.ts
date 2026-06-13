import fs from "node:fs";
import path from "node:path";

import { normGroup } from "../groups.js";
import { resolveNativeConsoleVisibilityConfig } from "../storage/backend/native.js";
import { isPlainObject } from "../utils/values.js";

const CONFIG_FILE_NAME = "tb.logger.json";

type ResolvedConsoleVisibilityPayload = {
  sourcePath: string | null;
  hideConsoleGroups: string[];
  warning: string | null;
};

type ConsoleVisibilityPolicy = ResolvedConsoleVisibilityPayload & {
  shouldHide(group: string): boolean;
};

function warningForInvalidShape(filePath: string): string {
  return `[trebired.logger] invalid ${CONFIG_FILE_NAME} at ${filePath}: expected an object with a hideConsoleGroups string array`;
}

function warningForReadError(filePath: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `[trebired.logger] failed to read ${CONFIG_FILE_NAME} at ${filePath}: ${detail}`;
}

function warningForParseError(filePath: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `[trebired.logger] invalid JSON in ${CONFIG_FILE_NAME} at ${filePath}: ${detail}`;
}

function normalizeHideConsoleGroups(input: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of input) {
    const normalized = normGroup(value).key;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function walkUpConfigPath(startDir: string): string | null {
  let current = path.resolve(startDir || process.cwd());

  while (true) {
    const candidate = path.join(current, CONFIG_FILE_NAME);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function parseConfigFile(filePath: string): ResolvedConsoleVisibilityPayload {
  let text = "";

  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return {
      sourcePath: filePath,
      hideConsoleGroups: [],
      warning: warningForReadError(filePath, error),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      sourcePath: filePath,
      hideConsoleGroups: [],
      warning: warningForParseError(filePath, error),
    };
  }

  if (!isPlainObject(parsed) || !Array.isArray(parsed.hideConsoleGroups) || parsed.hideConsoleGroups.some((item) => typeof item !== "string")) {
    return {
      sourcePath: filePath,
      hideConsoleGroups: [],
      warning: warningForInvalidShape(filePath),
    };
  }

  return {
    sourcePath: filePath,
    hideConsoleGroups: normalizeHideConsoleGroups(parsed.hideConsoleGroups),
    warning: null,
  };
}

function resolveConsoleVisibilityConfigJs(startDir = process.cwd()): ResolvedConsoleVisibilityPayload {
  const filePath = walkUpConfigPath(startDir);
  if (!filePath) {
    return {
      sourcePath: null,
      hideConsoleGroups: [],
      warning: null,
    };
  }

  return parseConfigFile(filePath);
}

function createPolicy(payload: ResolvedConsoleVisibilityPayload): ConsoleVisibilityPolicy {
  const hideConsoleGroups = normalizeHideConsoleGroups(Array.isArray(payload.hideConsoleGroups) ? payload.hideConsoleGroups : []);

  return {
    sourcePath: typeof payload.sourcePath === "string" ? payload.sourcePath : null,
    hideConsoleGroups,
    warning: typeof payload.warning === "string" && payload.warning ? payload.warning : null,
    shouldHide(group: string): boolean {
      const normalized = normGroup(group).key;
      return hideConsoleGroups.some((hiddenGroup) => normalized === hiddenGroup || normalized.startsWith(`${hiddenGroup}.`));
    },
  };
}

function resolveConsoleVisibilityPolicy(startDir = process.cwd()): ConsoleVisibilityPolicy {
  const nativePayload = resolveNativeConsoleVisibilityConfig(startDir);
  return createPolicy(nativePayload || resolveConsoleVisibilityConfigJs(startDir));
}

export {
  CONFIG_FILE_NAME,
  resolveConsoleVisibilityConfigJs,
  resolveConsoleVisibilityPolicy,
};
export type {
  ConsoleVisibilityPolicy,
  ResolvedConsoleVisibilityPayload,
};
