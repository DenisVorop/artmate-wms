export const MAX_WORKING_FIELD_METERS = 1000;
function addTenMeters(value: number): number {
  if (value + 10 >= MAX_WORKING_FIELD_METERS) return MAX_WORKING_FIELD_METERS;
  // Field dimensions are 1..1000 m; adding a whole metre count to their decimal
  // representation avoids tails like 40.269999999999996 without snapping them.
  const [whole, fraction] = String(value).split(".");
  return Number(`${Number(whole) + 10}${fraction ? `.${fraction}` : ""}`);
}
export function growWorkingField(
  size: { width: number; depth: number },
  side: "right" | "bottom",
): { width: number; depth: number } {
  return {
    width: side === "right" ? addTenMeters(size.width) : size.width,
    depth: side === "bottom" ? addTenMeters(size.depth) : size.depth,
  };
}
