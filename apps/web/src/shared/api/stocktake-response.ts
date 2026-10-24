const statuses = new Set([
  "queued",
  "counting",
  "review",
  "approved",
  "cancelled",
]);
/** Confirms a document response without treating it as a warehouse snapshot. */
export function isStocktakeCommandResponse(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return (
    typeof document.id === "string" &&
    !!document.id.trim() &&
    typeof document.code === "string" &&
    !!document.code.trim() &&
    typeof document.revision === "number" &&
    Number.isSafeInteger(document.revision) &&
    document.revision >= 0 &&
    typeof document.status === "string" &&
    statuses.has(document.status) &&
    Array.isArray(document.rows) &&
    document.rows.length > 0 &&
    document.rows.every(
      (row: unknown) =>
        !!row &&
        typeof row === "object" &&
        "locationId" in row &&
        typeof row.locationId === "string" &&
        !!row.locationId,
    )
  );
}
