/** Issuing labels confirms identifiers only; it never confirms warehouse stock. */
export function isIssuedLabelBatchResponse(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const batch = value as Record<string, unknown>;
  const integer = (v: unknown) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  return (
    typeof batch.id === "string" &&
    !!batch.id.trim() &&
    typeof batch.code === "string" &&
    !!batch.code.trim() &&
    integer(batch.count) &&
    (batch.count as number) >= 1 &&
    (batch.count as number) <= 1000 &&
    integer(batch.freeCount) &&
    integer(batch.assignedCount) &&
    (batch.freeCount as number) + (batch.assignedCount as number) ===
      batch.count &&
    typeof batch.createdAt === "string" &&
    Number.isFinite(Date.parse(batch.createdAt))
  );
}
