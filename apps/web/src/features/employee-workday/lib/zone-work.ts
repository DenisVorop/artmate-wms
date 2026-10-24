import type { WorkspaceDto } from "@/shared/api/generated/model";
export const workZonePrefix = "artmate-wms:work-zone:";
export function isWorkZoneScan(value: string) {
  return value.trim().startsWith(workZonePrefix);
}
export function ownZoneWork(
  data: WorkspaceDto | undefined,
  employeeId: string | undefined,
) {
  if (!data || !employeeId) return null;
  const assignment = data.warehouse.zoneWork?.find(
    (row) => row.employeeId === employeeId,
  );
  if (!assignment) return null;
  const zone = data.warehouse.workZones?.find(
    (row) => row.id === assignment.zoneId && !row.archived,
  );
  return zone ? { assignment, zone } : null;
}
