import type { ConsoleOptions, LogEntry, LogLevelConfig, LogStreamName, NormalizedConsoleOptions } from "../types.js";
import { formatDisplayTimestamp, normalizeLocale } from "../utils/datetime.js";
import { toString } from "../utils/values.js";

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

function hexToAnsi(hex: string, bold = false): string {
  const raw = toString(hex).replace(/^#/, "");
  const normalized = raw.length >= 6 ? raw.slice(0, 6) : "";
  if (!/^[a-f0-9]{6}$/i.test(normalized)) return bold ? "\x1b[1m" : "";

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `${bold ? "\x1b[1m" : ""}\x1b[38;2;${r};${g};${b}m`;
}

function color(options: NormalizedConsoleOptions, hex: string | undefined, value: unknown, bold = false): string {
  const text = String(value == null ? "" : value);
  if (!options.colors) return text;
  return `${hexToAnsi(hex || "", bold)}${text}\x1b[0m`;
}

function formatConsole(entry: LogEntry, levelConfig: LogLevelConfig, options: NormalizedConsoleOptions, timeZone: string): string {
  const levelText = color(options, levelConfig.color || "#ffffff", levelConfig.label || entry.level.toUpperCase(), levelConfig.bold === true);
  const bracketParts = [levelText];

  if (options.group) bracketParts.push(color(options, "#5c5c5c", entry.group));

  let line = `${color(options, "#ffffff", "[")}${bracketParts.join(color(options, "#5c5c5c", ", "))}${color(options, "#ffffff", "]")} ${entry.message}`;

  if (options.timestamp) {
    const when = color(options, "#8e8e8e", `|${formatDisplayTimestamp(entry.recorded_at, options.locale, timeZone)}|`);
    line = `${when} ${line}`;
  }

  if (options.metadata && entry.metadata && Object.keys(entry.metadata).length) {
    line += ` ${color(options, "#5c5c5c", JSON.stringify(entry.metadata))}`;
  }

  if (levelConfig.showStack === true && entry.metadata && entry.metadata.stack) line += `\n${String(entry.metadata.stack)}`;

  return line;
}

function writeConsole(streamName: LogStreamName | undefined, line: string): void {
  const safeLine = `${String(line == null ? "" : line)}\n`;
  if (streamName === "stderr" && process.stderr && typeof process.stderr.write === "function") {
    process.stderr.write(safeLine);
    return;
  }
  if (process.stdout && typeof process.stdout.write === "function") process.stdout.write(safeLine);
}

export { formatConsole, normalizeConsoleOptions, writeConsole };
