export function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}
