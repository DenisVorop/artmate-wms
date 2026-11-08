import type {
  StocktakeRowDto,
  WarehouseSpaceDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import { mapEntrance, mapFootprint, mapContains } from "./location-map";

type Layout = Pick<WorkspaceDto, "warehouse" | "locations" | "entrances">;
type Point = { x: number; y: number };
type Stop = Point & { rows: StocktakeRowDto[] };
type Group = { space?: WarehouseSpaceDto; stops: Map<string, Stop> };

const distance = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const addressOrder = new Intl.Collator("ru", { numeric: true });
const byAddress = (a: StocktakeRowDto, b: StocktakeRowDto) =>
  addressOrder.compare(a.locationCode, b.locationCode) ||
  a.locationId.localeCompare(b.locationId);

/** Derive a walking order from the current map, leaving saved document rows untouched. */
export function stocktakeWalk(
  rows: readonly StocktakeRowDto[],
  layout?: Layout,
  startAt?: string,
): StocktakeRowDto[] {
  const sorted = [...rows].sort(byAddress);
  if (!layout) return sorted;

  const locations = new Map(
    layout.locations.map((location) => [location.id, location]),
  );
  const spaces = layout.warehouse.spaces
    .filter((space) => !space.archived)
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const groups: Group[] = spaces.map((space) => ({ space, stops: new Map() }));
  const outside: Group = { stops: new Map() };
  const unmapped: StocktakeRowDto[] = [];
  let start: { group: Group; stop: Stop } | undefined;
  for (const row of sorted) {
    const location = locations.get(row.locationId);
    if (!location || location.archived) {
      unmapped.push(row);
      continue;
    }
    const footprint = mapFootprint(location);
    const group =
      groups.find(({ space }) => space && mapContains(space, footprint)) ??
      outside;
    const key = location.sectionId ?? location.id;
    let stop = group.stops.get(key);
    if (!stop) {
      stop = {
        x: footprint.x + footprint.width / 2,
        y: footprint.y + footprint.depth / 2,
        rows: [],
      };
      group.stops.set(key, stop);
    }
    stop.rows.push(row);
    if (row.locationId === startAt) start = { group, stop };
  }

  const ordered: StocktakeRowDto[] = [];
  const groupOrder = [...groups, outside].filter(
    (group) => group !== start?.group,
  );
  if (start) groupOrder.unshift(start.group);
  for (const group of groupOrder) {
    const stops = [...group.stops.values()];
    if (!stops.length) continue;
    const entrance = layout.entrances
      .filter((item) => item.spaceId === (group.space?.id ?? null))
      .map((item) => mapEntrance(item, layout))
      .find((line) => line !== null);
    let current: Point =
      start?.group === group
        ? start.stop
        : entrance
          ? {
              x: (entrance.x1 + entrance.x2) / 2,
              y: (entrance.y1 + entrance.y2) / 2,
            }
          : (group.space ?? { x: 0, y: 0 });
    if (start?.group === group) {
      const [currentStop] = stops.splice(stops.indexOf(start.stop), 1);
      ordered.push(
        ...currentStop.rows.filter((row) => row.locationId === startAt),
        ...currentStop.rows.filter((row) => row.locationId !== startAt),
      );
    }
    while (stops.length) {
      let nearest = 0;
      for (let i = 1; i < stops.length; i++) {
        if (distance(current, stops[i]) < distance(current, stops[nearest]))
          nearest = i;
      }
      const [stop] = stops.splice(nearest, 1);
      stop.rows.sort(
        (a, b) =>
          (locations.get(a.locationId)?.level ?? 0) -
            (locations.get(b.locationId)?.level ?? 0) || byAddress(a, b),
      );
      ordered.push(...stop.rows);
      current = stop;
    }
  }
  return [...ordered, ...unmapped];
}
