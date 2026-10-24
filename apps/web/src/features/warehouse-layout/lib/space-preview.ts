import type {
  WarehousePlanDto,
  WorkspaceDto,
  WarehouseSpaceDto,
} from "@/shared/api/generated/model";
import {
  rotatedFootprint,
  type PlanRectangle,
  type Point,
} from "./plan-geometry";

type SpacePreview = (Point & { id: string }) | null;
type SpaceScene = Pick<
  WorkspaceDto,
  "warehouse" | "sections" | "locations" | "aisles"
>;
const containmentTolerance = 1e-9;

/** Same old-footprint membership and tolerance as the server's atomic updateSpace. */
export function spaceContainsObject(
  space: WarehouseSpaceDto,
  object: PlanRectangle,
): boolean {
  const footprint = rotatedFootprint(object);
  return (
    object.x >= space.x - containmentTolerance &&
    object.y >= space.y - containmentTolerance &&
    object.x + footprint.width <=
      space.x + space.width + containmentTolerance &&
    object.y + footprint.depth <= space.y + space.depth + containmentTolerance
  );
}

/** A presentation snapshot only: stock identities and the query cache remain untouched. */
export function workspaceWithSpacePreview<T extends SpaceScene>(
  data: T,
  preview: SpacePreview,
): T {
  if (!preview?.id.startsWith("space:")) return data;
  const id = preview.id.slice("space:".length);
  const space = data.warehouse.spaces.find(
    (item) => item.id === id && !item.archived,
  );
  if (!space) return data;
  const delta = {
    x: Number((preview.x - space.x).toFixed(10)),
    y: Number((preview.y - space.y).toFixed(10)),
  };
  if (delta.x === 0 && delta.y === 0) return data;
  const sectionIds = new Set(
    data.sections
      .filter(
        (section) => !section.archived && spaceContainsObject(space, section),
      )
      .map((section) => section.id),
  );
  const translate = <TObject extends Point>(object: TObject): TObject => ({
    ...object,
    x: delta.x === 0 ? object.x : Number((object.x + delta.x).toFixed(10)),
    y: delta.y === 0 ? object.y : Number((object.y + delta.y).toFixed(10)),
  });
  return {
    ...data,
    warehouse: warehouseWithSpacePreview(data.warehouse, preview),
    sections: data.sections.map((section) =>
      sectionIds.has(section.id) ? translate(section) : section,
    ),
    locations: data.locations.map((location) =>
      (
        location.sectionId !== null
          ? sectionIds.has(location.sectionId)
          : !location.archived && spaceContainsObject(space, location)
      )
        ? translate(location)
        : location,
    ),
    aisles: data.aisles.map((aisle) =>
      !aisle.archived && spaceContainsObject(space, aisle)
        ? translate(aisle)
        : aisle,
    ),
  };
}

/** Floors, walls and spaceId-relative entrances use the same effective warehouse. */
export function warehouseWithSpacePreview(
  warehouse: WarehousePlanDto,
  preview: SpacePreview,
): WarehousePlanDto {
  if (!preview?.id.startsWith("space:")) return warehouse;
  const id = preview.id.slice("space:".length);
  if (!warehouse.spaces.some((space) => space.id === id && !space.archived))
    return warehouse;
  return {
    ...warehouse,
    spaces: warehouse.spaces.map((space) =>
      space.id === id && !space.archived
        ? { ...space, x: preview.x, y: preview.y }
        : space,
    ),
  };
}
