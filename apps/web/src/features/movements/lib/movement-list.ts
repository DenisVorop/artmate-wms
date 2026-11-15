import type { MovementDto } from "@/shared/api/generated/model";

export type MovementFilter = "active" | "all" | MovementDto["status"];

export function isActiveMovement(movement: MovementDto): boolean {
  return movement.status === "planned" || movement.status === "in_transit";
}

export function matchesMovementFilter(
  movement: MovementDto,
  filter: MovementFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "active") return isActiveMovement(movement);
  return movement.status === filter;
}
