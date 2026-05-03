function toString(value: unknown): string {
  return String(value == null ? "" : value).trim();
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value);
}

function clonePlain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[key] = clonePlain(value[key]);
  return out;
}

export { asObject, clonePlain, isPlainObject, toString };
