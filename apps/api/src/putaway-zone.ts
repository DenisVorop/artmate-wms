import type { PutawayTaskDto, WorkZoneDto } from "./dto";

export function putawayInZone(task: PutawayTaskDto, zone: WorkZoneDto) {
  return task.transferZoneId
    ? task.transferZoneId === zone.id
    : zone.locationIds.includes(task.fromLocationId);
}

export function putawayReservesDestination(task: PutawayTaskDto) {
  return (
    ["claimed", "in_transit"].includes(task.status) ||
    (!!task.transferZoneId && task.status === "queued")
  );
}
