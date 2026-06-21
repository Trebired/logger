import { DEFAULT_LEVELS } from "#cuh2x5snaefd";
import type { LogLevelConfig } from "#tvzweoxg5ahk";
import { toString } from "#ycytzc4gr3f7";

function assertLevelName(name: string): void {
  if (!/^[a-z0-9_-]+$/.test(name)) throw new Error(`invalid-log-level-name: ${name}`);
}

function normalizeLevels(input?: Record<string, LogLevelConfig>): Record<string, LogLevelConfig> {
  const levels: Record<string, LogLevelConfig> = {};

  for (const [name, cfg] of Object.entries(DEFAULT_LEVELS)) levels[name] = { ...cfg };

  const userLevels = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  for (const [rawName, rawConfig] of Object.entries(userLevels)) {
    const name = toString(rawName);
    assertLevelName(name);

    const cfg = rawConfig && typeof rawConfig === "object" ? rawConfig : null;
    const weight = Number(cfg && cfg.weight);
    if (!Number.isFinite(weight)) throw new Error(`invalid-log-level-weight: ${name}`);

    const existing: Partial<LogLevelConfig> = levels[name] || {};
    levels[name] = {
      ...existing,
      weight,
      label: toString(cfg && cfg.label) || existing.label || name.toUpperCase(),
      color: toString(cfg && cfg.color) || existing.color || "#ffffff",
      stream: cfg && cfg.stream === "stderr" ? "stderr" : cfg && cfg.stream === "stdout" ? "stdout" : existing.stream || "stdout",
      showStack: typeof (cfg && cfg.showStack) === "boolean" ? Boolean(cfg && cfg.showStack) : Boolean(existing.showStack),
      bold: typeof (cfg && cfg.bold) === "boolean" ? Boolean(cfg && cfg.bold) : Boolean(existing.bold),
    };
  }

  return Object.fromEntries(
    Object.entries(levels).sort(([aName, a], [bName, b]) => a.weight - b.weight || aName.localeCompare(bName)),
  );
}

function minLevelWeight(minLevel: string | number | undefined, levels: Record<string, LogLevelConfig>): number {
  if (typeof minLevel === "number") return Number.isFinite(minLevel) ? minLevel : Number.NEGATIVE_INFINITY;
  const name = toString(minLevel).toLowerCase();
  if (!name) return Number.NEGATIVE_INFINITY;
  if (!levels[name]) throw new Error(`unknown-min-log-level: ${name}`);
  return levels[name].weight;
}

function normalizeLevel(level: unknown, levels: Record<string, LogLevelConfig>): string {
  const name = toString(level).toLowerCase();
  return levels[name] ? name : "info";
}

export { assertLevelName, minLevelWeight, normalizeLevel, normalizeLevels };
