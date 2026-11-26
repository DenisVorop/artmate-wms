/** Audit acknowledgement is distinct from a warehouse mutation response. */
export function isTaskScanResponse(
  value: unknown,
): value is { recorded: true } {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "recorded" in value &&
    value.recorded === true
  );
}
