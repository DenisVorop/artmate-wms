import type {
  LocationDto,
  RackSectionDto,
  WarehouseSpaceDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";

type Footprint = Pick<LocationDto, "x" | "y" | "width" | "depth" | "rotation">;
export function locationInsideSpace(
  location: Footprint,
  space: Pick<WarehouseSpaceDto, "x" | "y" | "width" | "depth">,
): boolean {
  const turned = location.rotation === 90 || location.rotation === 270;
  const width = turned ? location.depth : location.width;
  const depth = turned ? location.width : location.depth;
  const epsilon = 1e-8;
  return (
    location.x >= space.x - epsilon &&
    location.y >= space.y - epsilon &&
    location.x + width <= space.x + space.width + epsilon &&
    location.y + depth <= space.y + space.depth + epsilon
  );
}

export function stocktakeLocations(locations: LocationDto[]): LocationDto[] {
  return locations
    .filter(
      (location) =>
        !location.archived &&
        (location.kind === "rack" || location.kind === "floor"),
    )
    .sort((a, b) => a.code.localeCompare(b.code, "ru", { numeric: true }));
}
/** Only the obvious occupied/blocked addresses are removed here. Server guards
 * still verify live reservations and operations when creating the document. */
export function openingStocktakeLocations(
  data: Pick<WorkspaceDto, "locations" | "pallets" | "addressHolds">,
) {
  const occupied = new Set(
    data.pallets.flatMap((pallet) =>
      pallet.locationId ? [pallet.locationId] : [],
    ),
  );
  const held = new Set(data.addressHolds?.map((hold) => hold.locationId) ?? []);
  return stocktakeLocations(data.locations).filter(
    (location) =>
      !location.blocked && !occupied.has(location.id) && !held.has(location.id),
  );
}

export function resolveStocktakeScope(
  scope: "room" | "section" | "locations",
  scopeId: string,
  explicitIds: string[],
  locations: LocationDto[],
  sections: RackSectionDto[],
  spaces: WarehouseSpaceDto[],
): LocationDto[] {
  const eligible = stocktakeLocations(locations);
  if (scope === "locations")
    return eligible.filter((location) => explicitIds.includes(location.id));
  if (scope === "section")
    return sections.some(
      (section) => section.id === scopeId && !section.archived,
    )
      ? eligible.filter((location) => location.sectionId === scopeId)
      : [];
  const space = spaces.find((item) => item.id === scopeId && !item.archived);
  return space
    ? eligible.filter((location) => locationInsideSpace(location, space))
    : [];
}
