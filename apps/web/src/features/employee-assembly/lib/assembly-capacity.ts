import type { TaskDto, WorkspaceDto } from "@/shared/api/generated/model";

/** A confirmed or partially filled box already owns its physical place.
 * Preallocated labels and a scanned source pallet do not open another box. */
export function assemblyWaitsForSpace(
  pressure: WorkspaceDto["assemblyPressure"],
  task: Pick<TaskDto, "boxCodeConfirmed" | "scannedUnits"> | null | undefined,
) {
  return (
    pressure?.level === "full" &&
    !!task &&
    !task.boxCodeConfirmed &&
    task.scannedUnits === 0
  );
}
