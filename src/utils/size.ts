function parseSize(value: string | number | undefined, fallback: number): number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;

  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;

  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)?$/.exec(raw);
  if (!match) return fallback;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallback;

  const unit = match[2] || "b";
  const factor =
    unit === "gb" || unit === "gib"
      ? 1024 * 1024 * 1024
      : unit === "mb" || unit === "mib"
        ? 1024 * 1024
        : unit === "kb" || unit === "kib"
          ? 1024
          : 1;

  return Math.max(1, Math.floor(amount * factor));
}

export { parseSize };
