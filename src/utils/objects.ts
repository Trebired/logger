function hasOwnKeys(value: unknown): boolean {
  if (value === null || value === undefined) return Object.keys(value as object).length > 0;
  for (const key in value as object) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  }
  return false;
}

export { hasOwnKeys };
