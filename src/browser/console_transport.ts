import { formatDisplayTimestamp } from "#0c4ri7nq63zi";
import { normalizeConsoleOptions } from "#b2k4pfb67duj";
import { normalizeLevels } from "#g4tupkl7rvk4";
import type {
  BrowserConsoleTransportOptions,
  BrowserTransport,
  LogEntry,
  LogLevelConfig,
  NormalizedConsoleOptions,
} from "#tvzweoxg5ahk";

function consoleMethodName(level: string, levelConfig: LogLevelConfig): "debug" | "info" | "warn" | "error" | "log" {
  if (level === "debug") return "debug";
  if (levelConfig.stream === "stderr") return level === "warn" ? "warn" : "error";
  if (level === "info" || level === "success") return "info";
  return "log";
}

function formatBrowserConsoleLine(entry: LogEntry, levelConfig: LogLevelConfig, options: NormalizedConsoleOptions, timeZone: string): string {
  const bracketParts = [levelConfig.label || entry.level.toUpperCase()];
  if (options.group) bracketParts.push(entry.group);

  let line = `[${bracketParts.join(", ")}] ${entry.message}`;

  if (options.timestamp) {
    line = `|${formatDisplayTimestamp(entry.recorded_at, options.locale, timeZone)}| ${line}`;
  }

  return line;
}

function createConsoleTransport(options: BrowserConsoleTransportOptions = {}): BrowserTransport {
  const consoleOptions = normalizeConsoleOptions(options.console);
  const timeZone = options.timeZone || "UTC";
  const levels = normalizeLevels(options.levels);

  return {
    name: "console",
    write(entries) {
      if (!consoleOptions.enabled) return;
      const target = globalThis.console;
      if (!target) return;

      for (const entry of entries) {
        const levelConfig = levels[entry.level] || levels.info;
        const methodName = consoleMethodName(entry.level, levelConfig);
        const method = typeof target[methodName] === "function" ? target[methodName] : target.log;
        const line = formatBrowserConsoleLine(entry, levelConfig, consoleOptions, timeZone);
        const args: unknown[] = [line];

        if (consoleOptions.metadata && entry.metadata && Object.keys(entry.metadata).length) args.push(entry.metadata);
        if (levelConfig.showStack === true && entry.metadata && entry.metadata.stack) args.push(String(entry.metadata.stack));

        method.apply(target, args);
      }
    },
  };
}

export { createConsoleTransport, formatBrowserConsoleLine };
