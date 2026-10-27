import type { WorkspaceDto } from "./generated/model";
import { isAssemblyPressure } from "./work-automation-response";

const legacyArrays = [
  "skus",
  "locations",
  "lots",
  "pallets",
  "boxes",
  "tasks",
  "employees",
  "shipments",
  "activities",
];
function hasArrays(value: unknown, keys: string[]) {
  return (
    !!value &&
    typeof value === "object" &&
    keys.every((key) => Array.isArray((value as Record<string, unknown>)[key]))
  );
}
/** Historical idempotent responses can have the previous workspace schema. */
export function isWorkspaceCommandResponse(value: unknown): boolean {
  return hasArrays(value, legacyArrays) && validAutomationFields(value);
}
function validAutomationFields(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    (data.assemblyPressure === undefined ||
      isAssemblyPressure(data.assemblyPressure)) &&
    Array.isArray(data.tasks) &&
    data.tasks.every((task) => {
      if (!task || typeof task !== "object") return false;
      const purpose = (task as Record<string, unknown>).autoPurpose;
      return (
        purpose === undefined || purpose === "urgent" || purpose === "backlog"
      );
    })
  );
}
export function isCurrentWorkspace(value: unknown): value is WorkspaceDto {
  if (
    !hasArrays(value, [
      ...legacyArrays,
      "sections",
      "movements",
      "aisles",
      "entrances",
      "receipts",
      "putawayTasks",
    ])
  )
    return false;
  if (!validAutomationFields(value)) return false;
  const revision = (value as Record<string, unknown>).revision;
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    return false;
  const balance = (value as Record<string, unknown>).balance;
  if (
    !balance ||
    typeof balance !== "object" ||
    ![
      "rawUnits",
      "workInProgressUnits",
      "boxedUnits",
      "totalUnits",
      "awaitingPlacementUnits",
      "awaitingPlacementPallets",
    ].every((key) => {
      const count = (balance as Record<string, unknown>)[key];
      return (
        typeof count === "number" && Number.isSafeInteger(count) && count >= 0
      );
    })
  )
    return false;
  const tasks = (value as Record<string, unknown>).tasks as unknown[];
  if (
    !tasks.every((task) => {
      if (!task || typeof task !== "object") return false;
      const item = task as Record<string, unknown>;
      return (
        typeof item.boxCodeConfirmed === "boolean" &&
        (item.createdAt === null ||
          (typeof item.createdAt === "string" &&
            Number.isFinite(Date.parse(item.createdAt))))
      );
    })
  )
    return false;
  const room = (value as Record<string, unknown>).warehouse;
  return (
    !!room &&
    typeof room === "object" &&
    typeof (room as Record<string, unknown>).name === "string" &&
    ["rectangle", "spaces"].includes(
      (room as Record<string, unknown>).layoutMode as string,
    ) &&
    Array.isArray((room as Record<string, unknown>).spaces) &&
    ["width", "depth"].every((key) => {
      const size = (room as Record<string, unknown>)[key];
      return (
        typeof size === "number" &&
        Number.isFinite(size) &&
        size >= 1 &&
        size <= 1000
      );
    })
  );
}

/** A slow read or historical replay must never roll the visible warehouse back. */
export function newestWorkspace(
  candidate: unknown,
  cached: unknown,
): WorkspaceDto | undefined {
  const current = isCurrentWorkspace(candidate) ? candidate : undefined;
  const previous = isCurrentWorkspace(cached) ? cached : undefined;
  if (!current) return previous;
  return previous && previous.revision > current.revision ? previous : current;
}
