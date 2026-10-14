import type { LogEntry } from "./types/common.js";

type LogGroupClaim = {
  group: string;
  level: string;
  source: string;
};

type LogGroupGuard = {
  check: (claim: LogGroupClaim) => void;
  prefixes: readonly string[];
};

let activeGuard: LogGroupGuard | null = null;
let guardedPrefixes = new Set<string>();

function registerLogGroupGuard(guard: LogGroupGuard | null): () => void {
  activeGuard = guard;
  guardedPrefixes = new Set(guard ? guard.prefixes.map((prefix) => String(prefix || "").trim()).filter(Boolean) : []);
  return () => {
    if (activeGuard === guard) registerLogGroupGuard(null);
  };
}

function resetLogGroupGuardForTests(): void {
  registerLogGroupGuard(null);
}

function runLogGroupGuard(entry: LogEntry): void {
  if (!activeGuard || guardedPrefixes.size === 0) return;
  const head = entry.group.split(".")[0] as string;
  if (!guardedPrefixes.has(head)) return;
  activeGuard.check({ group: entry.group, level: entry.level, source: entry.origin.source });
}

export { registerLogGroupGuard, resetLogGroupGuardForTests, runLogGroupGuard };
export type { LogGroupClaim, LogGroupGuard };
