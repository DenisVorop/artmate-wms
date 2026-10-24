import { EntranceDtoWall } from "@/shared/api/generated/model";
import { DEFAULT_STORAGE_FOOTPRINT } from "./location-form";
import type {
  EntranceDto,
  WarehousePlanDto,
  WarehouseSpaceDto,
} from "@/shared/api/generated/model";

export type Point = { x: number; y: number };
export type PlanRectangle = Point & {
  width: number;
  depth: number;
  rotation: number;
};
export type PlanBounds = Pick<WarehousePlanDto, "width" | "depth"> &
  Partial<Pick<WarehousePlanDto, "layoutMode" | "spaces">>;
export type EntrancePosition = Pick<EntranceDto, "wall" | "offset" | "spaceId">;
type ScopedEntrance = Pick<EntranceDto, "wall" | "offset" | "width"> &
  Partial<Pick<EntranceDto, "spaceId" | "archived">>;
export type SpaceDraft = Pick<
  WarehouseSpaceDto,
  "kind" | "x" | "y" | "width" | "depth"
>;

/** Rotation changes the outer footprint; x/y continue to denote its upper-left corner. */
export function rotatedFootprint(
  rectangle: Pick<PlanRectangle, "width" | "depth" | "rotation">,
) {
  const quarterTurn = rectangle.rotation === 90 || rectangle.rotation === 270;
  return {
    width: quarterTurn ? rectangle.depth : rectangle.width,
    depth: quarterTurn ? rectangle.width : rectangle.depth,
  };
}

export function snapAndClampPosition(
  point: Point,
  rectangle: Pick<PlanRectangle, "width" | "depth" | "rotation">,
  bounds: PlanBounds,
): Point {
  const footprint = rotatedFootprint(rectangle);
  const snap = (value: number) =>
    Number((Math.round(value * 10) / 10).toFixed(6));
  return {
    x: Math.max(
      0,
      Math.min(Math.max(0, bounds.width - footprint.width), snap(point.x)),
    ),
    y: Math.max(
      0,
      Math.min(Math.max(0, bounds.depth - footprint.depth), snap(point.y)),
    ),
  };
}

export function rectanglesOverlap(a: PlanRectangle, b: PlanRectangle): boolean {
  const first = rotatedFootprint(a),
    second = rotatedFootprint(b);
  return (
    a.x < b.x + second.width &&
    a.x + first.width > b.x &&
    a.y < b.y + second.depth &&
    a.y + first.depth > b.y
  );
}

/** A helpful draft position only. Actual collision/bounds approval belongs to the API. */
export function findSuggestedPosition(
  bounds: PlanBounds,
  obstacles: PlanRectangle[],
  size: Pick<
    PlanRectangle,
    "width" | "depth" | "rotation"
  > = DEFAULT_STORAGE_FOOTPRINT,
): Point | null {
  const footprint = rotatedFootprint(size);
  const floors =
    bounds.layoutMode === "spaces"
      ? (bounds.spaces ?? []).filter((space) => !space.archived)
      : [{ x: 0, y: 0, width: bounds.width, depth: bounds.depth }];
  let candidates = 0;
  for (const floor of floors) {
    for (
      let y = floor.y;
      y + footprint.depth <= Math.min(bounds.depth, floor.y + floor.depth);
      y = Number((y + 0.1).toFixed(6))
    ) {
      for (
        let x = floor.x;
        x + footprint.width <= Math.min(bounds.width, floor.x + floor.width);
        x = Number((x + 0.1).toFixed(6))
      ) {
        if (++candidates > 100000) return null;
        const candidate = { ...size, x, y };
        if (
          !obstacles.some((obstacle) => rectanglesOverlap(candidate, obstacle))
        )
          return { x, y };
      }
    }
  }
  return null;
}

export function entranceRegion(
  entrance: Pick<ScopedEntrance, "spaceId">,
  bounds: PlanBounds,
) {
  if (bounds.layoutMode !== "spaces")
    return {
      x: 0,
      y: 0,
      width: bounds.width,
      depth: bounds.depth,
      spaceId: null,
    };
  const space = (bounds.spaces ?? []).find(
    (space) => !space.archived && space.id === entrance.spaceId,
  );
  return space
    ? {
        x: space.x,
        y: space.y,
        width: space.width,
        depth: space.depth,
        spaceId: space.id,
      }
    : null;
}

export function entranceCenter(
  entrance: ScopedEntrance,
  bounds: PlanBounds,
): Point | null {
  const region = entranceRegion(entrance, bounds);
  if (!region) return null;
  const alongWall = entrance.offset + entrance.width / 2;
  switch (entrance.wall) {
    case EntranceDtoWall.north:
      return { x: region.x + alongWall, y: region.y };
    case EntranceDtoWall.south:
      return { x: region.x + alongWall, y: region.y + region.depth };
    case EntranceDtoWall.east:
      return { x: region.x + region.width, y: region.y + alongWall };
    case EntranceDtoWall.west:
      return { x: region.x, y: region.y + alongWall };
  }
}

/** A wide doorway can only attach to walls long enough to contain it. */
export function nearestEntrancePosition(
  point: Point,
  width: number,
  bounds: PlanBounds,
  preferredWall?: EntranceDto["wall"],
  preferredSpaceId?: EntranceDto["spaceId"],
): EntrancePosition | null {
  if (bounds.layoutMode === "spaces")
    return nearestSpaceEntrancePosition(
      point,
      width,
      bounds,
      preferredWall,
      preferredSpaceId,
    );
  const candidates = [
    {
      wall: EntranceDtoWall.north,
      distance: Math.abs(point.y),
      length: bounds.width,
      along: point.x,
    },
    {
      wall: EntranceDtoWall.east,
      distance: Math.abs(bounds.width - point.x),
      length: bounds.depth,
      along: point.y,
    },
    {
      wall: EntranceDtoWall.south,
      distance: Math.abs(bounds.depth - point.y),
      length: bounds.width,
      along: point.x,
    },
    {
      wall: EntranceDtoWall.west,
      distance: Math.abs(point.x),
      length: bounds.depth,
      along: point.y,
    },
  ].filter((candidate) => candidate.length >= width);
  candidates.sort(
    (a, b) =>
      a.distance - b.distance ||
      Number(b.wall === preferredWall) - Number(a.wall === preferredWall),
  );
  const wall = candidates[0];
  if (!wall) return null;
  const offset = Math.round((wall.along - width / 2) * 2) / 2;
  return {
    wall: wall.wall,
    spaceId: null,
    offset: Math.max(0, Math.min(wall.length - width, offset)),
  };
}

export function wallLine(
  wall: EntranceDto["wall"],
  start: number,
  end: number,
  bounds: PlanBounds,
) {
  switch (wall) {
    case EntranceDtoWall.north:
      return { x1: start, y1: 0, x2: end, y2: 0 };
    case EntranceDtoWall.south:
      return { x1: start, y1: bounds.depth, x2: end, y2: bounds.depth };
    case EntranceDtoWall.east:
      return { x1: bounds.width, y1: start, x2: bounds.width, y2: end };
    case EntranceDtoWall.west:
      return { x1: 0, y1: start, x2: 0, y2: end };
  }
}

/** Wall segments leave genuine gaps for active entrance openings. */
export function wallSegments(
  bounds: PlanBounds,
  entrances: Pick<EntranceDto, "wall" | "offset" | "width">[],
) {
  return Object.values(EntranceDtoWall).flatMap((wall) => {
    const length =
      wall === EntranceDtoWall.north || wall === EntranceDtoWall.south
        ? bounds.width
        : bounds.depth;
    const openings = entrances
      .filter((entrance) => entrance.wall === wall)
      .sort((a, b) => a.offset - b.offset);
    const segments: {
      wall: EntranceDto["wall"];
      start: number;
      end: number;
    }[] = [];
    let cursor = 0;
    for (const opening of openings) {
      const start = Math.max(0, Math.min(length, opening.offset));
      if (start > cursor) segments.push({ wall, start: cursor, end: start });
      cursor = Math.max(
        cursor,
        Math.min(length, opening.offset + opening.width),
      );
    }
    if (cursor < length) segments.push({ wall, start: cursor, end: length });
    return segments;
  });
}

export function entranceRotation(wall: EntranceDto["wall"]): number {
  return { north: 0, east: 90, south: 180, west: 270 }[wall];
}

function nearestSpaceEntrancePosition(
  point: Point,
  width: number,
  bounds: PlanBounds,
  preferredWall?: EntranceDto["wall"],
  preferredSpaceId?: EntranceDto["spaceId"],
): EntrancePosition | null {
  const candidates = (bounds.spaces ?? [])
    .filter((space) => !space.archived)
    .flatMap((space) =>
      Object.values(EntranceDtoWall).flatMap((wall) => {
        const horizontal =
          wall === EntranceDtoWall.north || wall === EntranceDtoWall.south;
        const length = horizontal ? space.width : space.depth;
        if (length < width) return [];
        const along = horizontal ? point.x - space.x : point.y - space.y;
        const offset = Math.max(
          0,
          Math.min(length - width, Math.round((along - width / 2) * 2) / 2),
        );
        const position = { wall, spaceId: space.id, offset };
        const center = entranceCenter({ ...position, width }, bounds)!;
        return [
          {
            ...position,
            distance: Math.hypot(point.x - center.x, point.y - center.y),
          },
        ];
      }),
    );
  candidates.sort((a, b) => {
    const distance = a.distance - b.distance;
    if (Math.abs(distance) > 1e-9) return distance;
    const exact =
      Number(b.spaceId === preferredSpaceId && b.wall === preferredWall) -
      Number(a.spaceId === preferredSpaceId && a.wall === preferredWall);
    return (
      exact ||
      Number(b.spaceId === preferredSpaceId) -
        Number(a.spaceId === preferredSpaceId)
    );
  });
  const candidate = candidates[0];
  return candidate
    ? {
        wall: candidate.wall,
        offset: candidate.offset,
        spaceId: candidate.spaceId,
      }
    : null;
}

type AxisInterval = {
  axis: "horizontal" | "vertical";
  fixed: number;
  start: number;
  end: number;
};
export type PlanWallLine = { x1: number; y1: number; x2: number; y2: number };
const epsilon = 1e-9;
function axisInterval(line: PlanWallLine): AxisInterval {
  return Math.abs(line.y1 - line.y2) < epsilon
    ? {
        axis: "horizontal",
        fixed: line.y1,
        start: Math.min(line.x1, line.x2),
        end: Math.max(line.x1, line.x2),
      }
    : {
        axis: "vertical",
        fixed: line.x1,
        start: Math.min(line.y1, line.y2),
        end: Math.max(line.y1, line.y2),
      };
}
function intervalLine(interval: AxisInterval): PlanWallLine {
  return interval.axis === "horizontal"
    ? {
        x1: interval.start,
        y1: interval.fixed,
        x2: interval.end,
        y2: interval.fixed,
      }
    : {
        x1: interval.fixed,
        y1: interval.start,
        x2: interval.fixed,
        y2: interval.end,
      };
}

/** Union collinear walls before cutting doorways: a shared physical wall is drawn only once. */
export function planWallLines(
  bounds: PlanBounds,
  entrances: ScopedEntrance[],
): PlanWallLine[] {
  const floors =
    bounds.layoutMode === "spaces"
      ? (bounds.spaces ?? []).filter((space) => !space.archived)
      : [{ x: 0, y: 0, width: bounds.width, depth: bounds.depth }];
  const groups: AxisInterval[][] = [];
  for (const floor of floors) {
    for (const wall of Object.values(EntranceDtoWall)) {
      const local = wallLine(
        wall,
        0,
        wall === EntranceDtoWall.north || wall === EntranceDtoWall.south
          ? floor.width
          : floor.depth,
        floor,
      );
      const edge = axisInterval({
        x1: local.x1 + floor.x,
        x2: local.x2 + floor.x,
        y1: local.y1 + floor.y,
        y2: local.y2 + floor.y,
      });
      const group = groups.find(
        (group) =>
          group[0].axis === edge.axis &&
          Math.abs(group[0].fixed - edge.fixed) < epsilon,
      );
      if (group) group.push(edge);
      else groups.push([edge]);
    }
  }
  const openings: AxisInterval[] = [];
  for (const entrance of entrances) {
    if (entrance.archived) continue;
    const region = entranceRegion(entrance, bounds);
    if (!region) continue;
    const local = wallLine(
      entrance.wall,
      entrance.offset,
      entrance.offset + entrance.width,
      region,
    );
    openings.push(
      axisInterval({
        x1: local.x1 + region.x,
        x2: local.x2 + region.x,
        y1: local.y1 + region.y,
        y2: local.y2 + region.y,
      }),
    );
  }
  return groups.flatMap((group) => {
    group.sort((a, b) => a.start - b.start);
    const merged: AxisInterval[] = [];
    for (const edge of group) {
      const previous = merged[merged.length - 1];
      if (previous && edge.start <= previous.end + epsilon)
        previous.end = Math.max(previous.end, edge.end);
      else merged.push({ ...edge });
    }
    return merged.flatMap((edge) => {
      const doors = openings
        .filter(
          (door) =>
            door.axis === edge.axis &&
            Math.abs(door.fixed - edge.fixed) < epsilon &&
            door.end > edge.start &&
            door.start < edge.end,
        )
        .sort((a, b) => a.start - b.start);
      const segments: AxisInterval[] = [];
      let cursor = edge.start;
      for (const door of doors) {
        const start = Math.max(edge.start, door.start);
        if (start > cursor + epsilon)
          segments.push({ ...edge, start: cursor, end: start });
        cursor = Math.max(cursor, Math.min(edge.end, door.end));
      }
      if (cursor < edge.end - epsilon)
        segments.push({ ...edge, start: cursor });
      return segments.map(intervalLine);
    });
  });
}

export function rectangleFromPoints(
  start: Point,
  end: Point,
  bounds: PlanBounds,
) {
  const snap = (value: number, max: number) =>
    Math.max(0, Math.min(max, Math.round(value * 2) / 2));
  const a = { x: snap(start.x, bounds.width), y: snap(start.y, bounds.depth) };
  const b = { x: snap(end.x, bounds.width), y: snap(end.y, bounds.depth) };
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    depth: Math.abs(a.y - b.y),
  };
}

export function hasDrawableSize(
  rectangle: Pick<SpaceDraft, "width" | "depth">,
): boolean {
  return rectangle.width >= 0.5 && rectangle.depth >= 0.5;
}
