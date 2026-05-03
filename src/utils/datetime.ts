const FALLBACK_TIME_ZONE = "America/New_York";

type LocalDateTimeParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

function normalizeTimeZone(input?: unknown): string {
  const raw = typeof input === "string" ? input.trim() : "";
  const candidate = raw || Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE;

  try {
    return Intl.DateTimeFormat("en-US", { timeZone: candidate }).resolvedOptions().timeZone || FALLBACK_TIME_ZONE;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

function normalizeLocale(input?: unknown): string | undefined {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return undefined;

  try {
    const supported = Intl.DateTimeFormat.supportedLocalesOf([raw]);
    return supported[0];
  } catch {
    return undefined;
  }
}

function safeDate(input?: unknown): Date {
  const date = input instanceof Date ? input : input ? new Date(String(input)) : new Date();
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function getLocalDateTimeParts(input: unknown, timeZone: string): LocalDateTimeParts {
  const date = safeDate(input);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values: Record<string, string> = {};

  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  return {
    year: values.year || "1970",
    month: values.month || "01",
    day: values.day || "01",
    hour: values.hour || "00",
    minute: values.minute || "00",
    second: values.second || "00",
  };
}

const EUROPEAN_DOT_DATE_LANGUAGES = new Set([
  "bg",
  "cs",
  "da",
  "de",
  "et",
  "fi",
  "hr",
  "hu",
  "is",
  "lt",
  "lv",
  "no",
  "pl",
  "ro",
  "sk",
  "sl",
  "sr",
  "sv",
  "uk",
]);

const EUROPEAN_DOT_DATE_REGIONS = new Set([
  "AT",
  "BA",
  "BG",
  "CH",
  "CZ",
  "DE",
  "DK",
  "EE",
  "FI",
  "HR",
  "HU",
  "IS",
  "LI",
  "LT",
  "LV",
  "NO",
  "PL",
  "RO",
  "RS",
  "SE",
  "SI",
  "SK",
  "UA",
]);

function usesEuropeanDotDateStyle(locale: string | undefined): boolean {
  if (typeof locale !== "string" || !locale.trim()) return false;

  try {
    const parsed = new Intl.Locale(locale);
    const language = parsed.language.toLowerCase();
    const region = parsed.region ? parsed.region.toUpperCase() : "";
    return EUROPEAN_DOT_DATE_LANGUAGES.has(language) || EUROPEAN_DOT_DATE_REGIONS.has(region);
  } catch {
    const normalized = locale.toLowerCase();
    return Array.from(EUROPEAN_DOT_DATE_LANGUAGES).some((language) => normalized === language || normalized.startsWith(`${language}-`));
  }
}

function formatDisplayTimestamp(input: unknown, locale: string | undefined, timeZone: string): string {
  const date = safeDate(input);
  const normalizedLocale = normalizeLocale(locale);
  const parts = getLocalDateTimeParts(date, timeZone);

  if (usesEuropeanDotDateStyle(normalizedLocale)) {
    return `${parts.day}.${parts.month}.${parts.year}, ${parts.hour}:${parts.minute}:${parts.second}`;
  }

  try {
    return new Intl.DateTimeFormat(normalizedLocale, {
      timeZone: normalizeTimeZone(timeZone),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: FALLBACK_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(date);
  }
}

export { FALLBACK_TIME_ZONE, formatDisplayTimestamp, getLocalDateTimeParts, normalizeLocale, normalizeTimeZone };
export type { LocalDateTimeParts };
