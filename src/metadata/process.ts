import { DEFAULT_SENSITIVE_KEYS, RESERVED_METADATA_KEYS } from "#cuh2x5snaefd";
import type { RedactOptions } from "#e1h3ay0cyhgl";
import {
  clonePlain,
  isPlainObject,
  toObject as asObject,
  toTrimmedString as toString,
} from "@trebired/utils";

function copyMetadata(input: unknown, mapValue: (value: unknown) => unknown): Record<string, unknown> {
  const src = asObject(input);
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(src)) {
    if (RESERVED_METADATA_KEYS.has(key)) continue;
    if (src[key] === undefined) continue;
    out[key] = mapValue(src[key]);
  }

  return out;
}

function sanitizeMetadata(input: unknown): Record<string, unknown> {
  return copyMetadata(input, (value) => value);
}

function normalizeErrorValue(error: Error): Record<string, unknown> {
  const out: Record<string, unknown> = { name: error.name, message: error.message };

  for (const key of Object.keys(error)) {
    if (key === "name" || key === "message") continue;
    out[key] = normalizeErrors((error as unknown as Record<string, unknown>)[key]);
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined) out.cause = normalizeErrors(cause);

  return out;
}

function normalizeErrors(value: unknown): unknown {
  if (value instanceof Error) return normalizeErrorValue(value);
  if (Array.isArray(value)) return value.map((item) => normalizeErrors(item));
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[key] = normalizeErrors(value[key]);
  return out;
}

function applySerializers(input: Record<string, unknown>, serializers?: Record<string, (value:unknown)=>unknown>): Record<string, unknown> {
  if (!serializers || typeof serializers !== "object") return input;
  const out = clonePlain(input) as Record<string, unknown>;

  function visit(value: unknown, path: string): unknown {
    if (Array.isArray(value)) return value.map((item, index) => visit(item, path ? `${path}.${index}` : String(index)));
    if (!isPlainObject(value)) return value;

    const obj: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const childPath = path ? `${path}.${key}` : key;
      const serializer = serializers[childPath] || serializers[key];
      const childValue = visit(value[key], childPath);
      if (serializer) {
        try {
          obj[key] = serializer(childValue);
        } catch (error) {
          obj[key] = `[serializer-error:${error instanceof Error ? error.message : String(error)}]`;
        }
      } else {
        obj[key] = childValue;
      }
    }
    return obj;
  }

  return visit(out, "") as Record<string, unknown>;
}

function shouldRedact(path: string, key: string, options: Required<Pick<RedactOptions, "includeDefaultSensitiveKeys">>&RedactOptions): boolean {
  const lowerKey = key.toLowerCase();
  if (options.includeDefaultSensitiveKeys !== false && DEFAULT_SENSITIVE_KEYS.has(lowerKey)) return true;

  const paths = Array.isArray(options.paths) ? options.paths : [];
  for (const pattern of paths) {
    if (typeof pattern === "string" && (pattern === path || pattern === key)) return true;
    if (pattern instanceof RegExp && pattern.test(path)) return true;
  }

  return false;
}

function redactMetadata(input: Record<string, unknown>, options?: RedactOptions): Record<string, unknown> {
  const cfg = options || {};
  const replacement = toString(cfg.replacement) || "[REDACTED]";
  const includeDefaultSensitiveKeys = cfg.includeDefaultSensitiveKeys !== false;
  const redactOptions = { ...cfg, includeDefaultSensitiveKeys };

  function visit(value: unknown, path: string, key: string): unknown {
    if (shouldRedact(path, key, redactOptions)) {
      if (typeof cfg.transform === "function") {
        try {
          return cfg.transform({ path, key, value, replacement });
        } catch {
          return replacement;
        }
      }
      return replacement;
    }

    if (Array.isArray(value)) return value.map((item, index) => visit(item, path ? `${path}.${index}` : String(index), String(index)));
    if (!isPlainObject(value)) return value;

    const out: Record<string, unknown> = {};
    for (const childKey of Object.keys(value)) {
      const childPath = path ? `${path}.${childKey}` : childKey;
      out[childKey] = visit(value[childKey], childPath, childKey);
    }
    return out;
  }

  return visit(input, "", "") as Record<string, unknown>;
}

function prepareMetadata(input: unknown, serializers?: Record<string, (value:unknown)=>unknown>, redact?: RedactOptions): Record<string, unknown> {
  const normalized = copyMetadata(input, normalizeErrors);
  const serialized = applySerializers(normalized, serializers);
  return redactMetadata(serialized, redact);
}

export { applySerializers, normalizeErrors, prepareMetadata, redactMetadata, sanitizeMetadata };
