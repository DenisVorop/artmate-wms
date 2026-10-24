/** RHF may re-register the parsed value, not only the original input string. */
export function nullableNumberFromInput(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return Number(value);
}
