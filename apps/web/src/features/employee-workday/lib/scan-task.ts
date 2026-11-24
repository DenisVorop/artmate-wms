import type {
  WorkspaceDto,
  ZoneWorkDto,
  GetTaskHistoryKind,
} from "@/shared/api/generated/model";
import type { EmployeeMode } from "./workday";
export function employeeScanTask(
  data: WorkspaceDto | undefined,
  employeeId: string | undefined,
  mode: EmployeeMode,
  selection: {
    stocktakeId?: string;
    movementId?: string;
    zoneId?: string;
    assignment?: Pick<ZoneWorkDto, "jobKind" | "jobId">;
  },
): { kind: GetTaskHistoryKind; id: string } | undefined {
  if (mode === "stocktakes" && selection.stocktakeId)
    return { kind: "stocktake", id: selection.stocktakeId };
  if (mode === "movements" && selection.movementId)
    return { kind: "movement", id: selection.movementId };
  const assignment = selection.assignment;
  // The "any ready box" offer uses its zone ID until takeAnyPutawayBox
  // atomically resolves and assigns the actual task. It is not a task ID.
  // The take command already records this first box scan on that task.
  if (
    assignment?.jobKind === "putaway" &&
    assignment.jobId &&
    assignment.jobId === selection.zoneId
  )
    return;
  if (
    assignment?.jobId &&
    assignment.jobKind &&
    ["assembly", "putaway", "receiving", "shipping"].includes(
      assignment.jobKind,
    )
  )
    return {
      kind: assignment.jobKind as GetTaskHistoryKind,
      id: assignment.jobId,
    };
  if (!data || !employeeId) return;
  const own = (row: { employeeId?: string | null }) =>
    row.employeeId === employeeId;
  if (mode === "assembly") {
    const task = data.tasks.find((row) => own(row) && row.status === "active");
    if (task) return { kind: "assembly", id: task.id };
  }
  if (mode === "putaway") {
    const task = data.putawayTasks.find(
      (row) => own(row) && ["claimed", "in_transit"].includes(row.status),
    );
    if (task) return { kind: "putaway", id: task.id };
  }
  if (mode === "shipping") {
    const task = data.shipments.find(
      (row) => own(row) && row.status === "draft",
    );
    if (task) return { kind: "shipping", id: task.id };
  }
}
