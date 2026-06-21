import type { ConsoleOptions, NormalizedConsoleOptions } from "#tvzweoxg5ahk";
import { normalizeLocale } from "#0c4ri7nq63zi";

function normalizeConsoleOptions(input: boolean | ConsoleOptions | undefined): NormalizedConsoleOptions {
  if (input === false) {
    return { enabled: false, colors: true, timestamp: true, group: true, metadata: true, locale: normalizeLocale() };
  }

  if (input && typeof input === "object") {
    return {
      enabled: input.enabled !== false,
      colors: input.colors !== false,
      timestamp: input.timestamp !== false,
      group: input.group !== false,
      metadata: input.metadata !== false,
      locale: normalizeLocale(input.locale),
    };
  }

  return { enabled: true, colors: true, timestamp: true, group: true, metadata: true, locale: normalizeLocale() };
}

export { normalizeConsoleOptions };
