import type {
  EntranceDto,
  LocationDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";

export type LocationMapData = Pick<
  WorkspaceDto,
  "warehouse" | "locations" | "sections" | "aisles" | "entrances"
> & { revision?: number };
export type MapRectangle = {
  x: number;
  y: number;
  width: number;
  depth: number;
};
export type MapShape = MapRectangle & {
  id: string;
  label: string;
  kind: "section" | "location";
};
export type MapLine = { x1: number; y1: number; x2: number; y2: number };

/** The warehouse stores the upper-left corner of the rotated outer footprint. */
export function mapFootprint(
  rectangle: MapRectangle & { rotation?: number },
): MapRectangle {
  const turned = rectangle.rotation === 90 || rectangle.rotation === 270;
  return {
    x: rectangle.x,
    y: rectangle.y,
    width: turned ? rectangle.depth : rectangle.width,
    depth: turned ? rectangle.width : rectangle.depth,
  };
}
function valid(rectangle: MapRectangle) {
  return (
    [rectangle.x, rectangle.y, rectangle.width, rectangle.depth].every(
      Number.isFinite,
    ) &&
    rectangle.width > 0 &&
    rectangle.depth > 0
  );
}
function contains(outer: MapRectangle, inner: MapRectangle) {
  const epsilon = 1e-6;
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.depth <= outer.y + outer.depth + epsilon
  );
}
function padded(rectangle: MapRectangle): MapRectangle {
  const padding = Math.max(
    0.35,
    Math.min(rectangle.width, rectangle.depth) * 0.06,
  );
  return {
    x: rectangle.x - padding,
    y: rectangle.y - padding,
    width: rectangle.width + padding * 2,
    depth: rectangle.depth + padding * 2,
  };
}
function union(rectangles: MapRectangle[]): MapRectangle {
  const x = Math.min(...rectangles.map((rect) => rect.x));
  const y = Math.min(...rectangles.map((rect) => rect.y));
  return {
    x,
    y,
    width: Math.max(...rectangles.map((rect) => rect.x + rect.width)) - x,
    depth: Math.max(...rectangles.map((rect) => rect.y + rect.depth)) - y,
  };
}

/** Door offsets are local to their room, while all rendered coordinates are global. */
export function mapEntrance(
  entrance: EntranceDto,
  data: LocationMapData,
): MapLine | null {
  if (
    entrance.archived ||
    !Number.isFinite(entrance.offset) ||
    !Number.isFinite(entrance.width) ||
    entrance.width <= 0
  )
    return null;
  const region =
    data.warehouse.layoutMode === "spaces"
      ? data.warehouse.spaces.find(
          (space) => !space.archived && space.id === entrance.spaceId,
        )
      : {
          x: 0,
          y: 0,
          width: data.warehouse.width,
          depth: data.warehouse.depth,
        };
  if (!region || !valid(region)) return null;
  const horizontal = entrance.wall === "north" || entrance.wall === "south";
  const length = horizontal ? region.width : region.depth;
  const start = Math.max(0, entrance.offset);
  const end = Math.min(length, entrance.offset + entrance.width);
  if (end <= start) return null;
  if (horizontal) {
    const y = region.y + (entrance.wall === "south" ? region.depth : 0);
    return { x1: region.x + start, y1: y, x2: region.x + end, y2: y };
  }
  const x = region.x + (entrance.wall === "east" ? region.width : 0);
  return { x1: x, y1: region.y + start, x2: x, y2: region.y + end };
}

export function createLocationMap(
  data: LocationMapData,
  locationId: string | null | undefined,
) {
  const location = data.locations.find((item) => item.id === locationId);
  if (!location || location.archived)
    return {
      available: false as const,
      message:
        "Адрес недоступен на текущей карте. Уточните место у руководителя.",
    };
  const section = location.sectionId
    ? data.sections.find(
        (item) => item.id === location.sectionId && !item.archived,
      )
    : null;
  if (location.sectionId && !section)
    return {
      available: false as const,
      message:
        "Секция этого адреса недоступна на текущей карте. Уточните место у руководителя.",
    };
  const target = mapFootprint(section ?? location);
  if (!valid(target))
    return {
      available: false as const,
      message:
        "Для этого адреса не заданы размеры на карте. Уточните место у руководителя.",
    };
  const spaces =
    data.warehouse.layoutMode === "spaces"
      ? data.warehouse.spaces.filter((space) => !space.archived && valid(space))
      : [
          {
            id: "warehouse",
            name: data.warehouse.name,
            kind: "room" as const,
            x: 0,
            y: 0,
            width: data.warehouse.width,
            depth: data.warehouse.depth,
          },
        ].filter(valid);
  const room =
    spaces
      .filter((space) => contains(space, target))
      .sort((a, b) => a.width * a.depth - b.width * b.depth)
      .find(() => true) ?? null;
  const shapes: MapShape[] = [
    ...data.sections
      .filter((item) => !item.archived)
      .map((item) => ({
        ...mapFootprint(item),
        id: item.id,
        label: item.code,
        kind: "section" as const,
      })),
    ...data.locations
      .filter((item) => !item.archived && !item.sectionId)
      .map((item) => ({
        ...mapFootprint(item),
        id: item.id,
        label: item.code,
        kind: "location" as const,
      })),
  ].filter(valid);
  const warehouse = {
    x: 0,
    y: 0,
    width: data.warehouse.width,
    depth: data.warehouse.depth,
  };
  const wholeBounds = padded(
    union([
      ...(data.warehouse.layoutMode !== "spaces" && valid(warehouse)
        ? [warehouse]
        : []),
      ...spaces,
      ...shapes,
      target,
    ]),
  );
  return {
    available: true as const,
    location,
    target,
    targetShapeId: section?.id ?? location.id,
    section,
    room,
    spaces,
    shapes,
    aisles: data.aisles
      .filter((item) => !item.archived)
      .map(mapFootprint)
      .filter(valid),
    entrances: data.entrances
      .map((item) => mapEntrance(item, data))
      .filter((line): line is MapLine => line !== null),
    focusedBounds: room ? padded(room) : wholeBounds,
    wholeBounds,
    detail: locationDetail(location),
  };
}
export function locationDetail(
  location: Pick<LocationDto, "kind" | "level" | "sectionId">,
) {
  if (location.sectionId || location.kind === "rack")
    return `Ярус ${location.level}`;
  return "Напольное место";
}
