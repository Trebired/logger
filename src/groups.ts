import { TOP_LEVEL } from "./constants.js";
import { toTrimmedString as toString } from "@trebired/utils";

const GROUP_KEY_CACHE_LIMIT = 1024;
const groupKeyCache = new Map<string, string>();

function cleanGroupPart(part: string): string {
  return toString(part).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function computeGroupKey(input: unknown): string {
  const raw = toString(input) || TOP_LEVEL;
  const parts = raw.split(".").map(cleanGroupPart).filter(Boolean);
  return parts.length ? parts.join(".") : TOP_LEVEL;
}

function normGroupKey(input: unknown): string {
  if (typeof input !== "string") return computeGroupKey(input);
  const cached = groupKeyCache.get(input);
  if (cached !== undefined) return cached;
  const key = computeGroupKey(input);
  if (groupKeyCache.size >= GROUP_KEY_CACHE_LIMIT) groupKeyCache.clear();
  groupKeyCache.set(input, key);
  return key;
}

function normGroup(input: unknown): { key: string; parts: string[] } {
  const key = normGroupKey(input);
  return {
    key,
    parts: key.split("."),
  };
}

export { normGroup, normGroupKey };
