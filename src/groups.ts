import { TOP_LEVEL } from "./constants.js";
import { toString } from "./utils/values.js";

function cleanGroupPart(part: string): string {
  return toString(part).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function normGroup(input: unknown): { key: string; parts: string[] } {
  const raw = toString(input) || TOP_LEVEL;
  const parts = raw.split(".").map(cleanGroupPart).filter(Boolean);
  const safeParts = parts.length ? parts : [TOP_LEVEL];
  return {
    key: safeParts.join("."),
    parts: safeParts,
  };
}

function groupKeyFromRelDir(relDir: string): string {
  const trimmed = String(relDir || "").replace(/^[/\\]+|[/\\]+$/g, "");
  if (!trimmed) return TOP_LEVEL;
  return trimmed.split(/[\\/]+/).filter(Boolean).join(".");
}

export { groupKeyFromRelDir, normGroup };
