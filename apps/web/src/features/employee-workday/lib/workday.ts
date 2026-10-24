import type { WorkspaceDto } from "@/shared/api/generated/model";
export type EmployeeMode =
  | "assembly"
  | "putaway"
  | "receiving"
  | "movements"
  | "stocktakes"
  | "shift";
export function employeeMode(value?: string): EmployeeMode {
  return [
    "assembly",
    "putaway",
    "receiving",
    "movements",
    "stocktakes",
    "shift",
  ].includes(value ?? "")
    ? (value as EmployeeMode)
    : "assembly";
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
