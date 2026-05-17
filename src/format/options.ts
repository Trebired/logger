import type { ConsoleOptions, NormalizedConsoleOptions } from "../types.js";
import { normalizeLocale } from "../utils/datetime.js";

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
