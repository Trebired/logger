export function toString(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}
