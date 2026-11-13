import type { WorkspaceDto } from "@/shared/api/generated/model";
export type EmployeeMode =
  | "assembly"
  | "putaway"
  | "receiving"
  | "movements"
  | "stocktakes"
  | "shift"
  | "zone"
  | "shipping";
export function employeeMode(value?: string): EmployeeMode {
  return [
    "assembly",
    "putaway",
    "receiving",
    "movements",
    "stocktakes",
    "shift",
    "zone",
    "shipping",
  ].includes(value ?? "")
    ? (value as EmployeeMode)
    : "zone";
}
export function employeePriority(
  data: WorkspaceDto,
  employeeId: string,
): { mode: EmployeeMode; carrying: boolean } | null {
  if (
    data.putawayTasks.some(
      (t) => t.employeeId === employeeId && t.status === "in_transit",
    )
  )
    return { mode: "putaway", carrying: true };
  if (
    data.movements.some(
      (t) => t.employeeId === employeeId && t.status === "in_transit",
    )
  )
    return { mode: "movements", carrying: true };
  if (
    data.shipments.some(
      (shipment) =>
        shipment.employeeId === employeeId &&
        shipment.pickingMode === "box" &&
        shipment.status === "draft" &&
        (!shipment.wb ||
          shipment.boxIds.some(
            (boxId) => !shipment.scannedBoxIds?.includes(boxId),
          )),
    )
  )
    return { mode: "shipping", carrying: false };
  if (
    data.putawayTasks.some(
      (t) => t.employeeId === employeeId && t.status === "claimed",
    )
  )
    return { mode: "putaway", carrying: false };
  if (
    data.tasks.some((t) => t.employeeId === employeeId && t.status === "active")
  )
    return { mode: "assembly", carrying: false };
  if (
    data.movements.some(
      (t) => t.employeeId === employeeId && t.status === "planned",
    )
  )
    return { mode: "movements", carrying: false };
  return null;
}
