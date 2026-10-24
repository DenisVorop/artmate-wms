import { BadRequestException } from "@nestjs/common";
import * as D from "./dto";
type Rect = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: number;
};
type Box = { x: number; y: number; width: number; depth: number };
export type DoorSegment = {
  axis: "horizontal" | "vertical";
  line: number;
  start: number;
  end: number;
};
const epsilon = 1e-9;
function reject(message: string): never {
  throw new BadRequestException(message);
}
export function footprint(
  rect: Pick<Rect, "x" | "y" | "width" | "depth" | "rotation">,
): Box {
  const turned = rect.rotation === 90 || rect.rotation === 270;
  return {
    x: rect.x,
    y: rect.y,
    width: turned ? rect.depth : rect.width,
    depth: turned ? rect.width : rect.depth,
  };
}
function overlaps(a: Box, b: Box) {
  return (
    a.x < b.x + b.width - epsilon &&
    a.x + a.width > b.x + epsilon &&
    a.y < b.y + b.depth - epsilon &&
    a.y + a.depth > b.y + epsilon
  );
}
function contains(outer: Box, inner: Box) {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.depth <= outer.y + outer.depth + epsilon
  );
}
export function checkBounds(
  plan: D.WarehousePlanDto,
  rect: Rect,
  minSize = 0.1,
) {
  if (
    ![rect.x, rect.y, rect.width, rect.depth, rect.rotation].every(
      Number.isFinite,
    ) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width < minSize ||
    rect.depth < minSize ||
    ![0, 90, 180, 270].includes(rect.rotation)
  )
    reject("Неверная геометрия: проверьте размеры, координаты и поворот");
  const box = footprint(rect);
  if (
    box.x + box.width > plan.width + epsilon ||
    box.y + box.depth > plan.depth + epsilon
  )
    reject(`«${rect.name}» выходит за границы рабочего поля`);
  if (
    plan.layoutMode === "spaces" &&
    !plan.spaces.some((space) => !space.archived && contains(space, box))
  )
    reject(
      `«${rect.name}» должен целиком находиться в одном помещении или коридоре`,
    );
}
export function checkRect(
  s: D.WorkspaceDto,
  rect: Rect,
  type: "section" | "location" | "aisle",
) {
  checkBounds(s.warehouse, rect, type === "aisle" ? 0.5 : 0.1);
  const candidates = [
    ...s.sections.filter(
      (x) => !x.archived && !(type === "section" && x.id === rect.id),
    ),
    ...s.locations.filter(
      (x) =>
        !x.archived &&
        !x.sectionId &&
        !(type === "location" && x.id === rect.id),
    ),
    ...(type === "aisle" ? [] : s.aisles.filter((x) => !x.archived)),
  ];
  const conflict = candidates.find((other) =>
    overlaps(footprint(rect), footprint(other)),
  );
  if (conflict)
    reject(
      `«${rect.name}» пересекается с «${conflict.name}». Освободите место или измените геометрию`,
    );
}
/** Boundary resize preserves positions and ownership of all OLD active members. */
export function checkSpaceResizeContents(
  s: D.WorkspaceDto,
  oldSpace: D.WarehouseSpaceDto,
  nextSpace: D.WarehouseSpaceDto,
) {
  const members = [
    ...s.sections.filter((r) => !r.archived),
    ...s.locations.filter((r) => !r.archived && !r.sectionId),
    ...s.aisles.filter((r) => !r.archived),
  ].filter((r) => contains(oldSpace, footprint(r)));
  for (const r of members)
    if (!contains(nextSpace, footprint(r)))
      reject(
        `«${r.name}» должен целиком оставаться в том же участке после изменения границ`,
      );
}
/** Move the active contents of the OLD space; levels follow their section exactly once. */
export function translateSpaceContents(
  s: D.WorkspaceDto,
  oldSpace: D.WarehouseSpaceDto,
  nextSpace: D.WarehouseSpaceDto,
) {
  const dx = Number((nextSpace.x - oldSpace.x).toFixed(10)),
    dy = Number((nextSpace.y - oldSpace.y).toFixed(10));
  if (dx === 0 && dy === 0) return;
  const sections = s.sections.filter(
    (r) => !r.archived && contains(oldSpace, footprint(r)),
  );
  const sectionIds = new Set(sections.map((r) => r.id));
  const standalone = s.locations.filter(
    (r) => !r.archived && !r.sectionId && contains(oldSpace, footprint(r)),
  );
  const standaloneIds = new Set(standalone.map((r) => r.id));
  const aisles = s.aisles.filter(
    (r) => !r.archived && contains(oldSpace, footprint(r)),
  );
  const aisleIds = new Set(aisles.map((r) => r.id));
  for (const r of [
    ...sections,
    ...standalone,
    ...aisles,
    ...s.locations.filter((l) => l.sectionId && sectionIds.has(l.sectionId)),
  ]) {
    if (dx !== 0) r.x = Number((r.x + dx).toFixed(10));
    if (dy !== 0) r.y = Number((r.y + dy).toFixed(10));
  }
  for (const r of [...sections, ...standalone, ...aisles]) {
    if (!contains(nextSpace, footprint(r)))
      reject(
        `«${r.name}» должен целиком помещаться в тот же участок после переноса и изменения размеров`,
      );
  }
  // Existing overlaps inside the rigid group are unchanged. Reject new cross-group collisions.
  const outside = {
    ...s,
    sections: s.sections.filter((r) => !sectionIds.has(r.id)),
    locations: s.locations.filter(
      (r) => r.sectionId || !standaloneIds.has(r.id),
    ),
    aisles: s.aisles.filter((r) => !aisleIds.has(r.id)),
  };
  for (const r of sections) checkRect(outside, r, "section");
  for (const r of standalone) checkRect(outside, r, "location");
  for (const r of aisles) checkRect(outside, r, "aisle");
}
export function checkSpace(
  plan: D.WarehousePlanDto,
  space: D.WarehouseSpaceDto,
) {
  // Spaces are checked against the canvas, never against existing floor coverage.
  checkBounds(
    { ...plan, layoutMode: "rectangle" },
    { ...space, rotation: 0 },
    0.5,
  );
  if (space.width > 1000 || space.depth > 1000)
    reject("Размер участка не должен превышать 1000 метров");
  if (!["room", "corridor"].includes(space.kind))
    reject("Тип участка: помещение или коридор");
  const active = plan.spaces.filter((other) => !other.archived);
  if (active.length > 100) reject("Допускается не более 100 активных участков");
  const conflict = active.find(
    (other) => other.id !== space.id && overlaps(space, other),
  );
  if (conflict)
    reject(`«${space.name}» пересекается с участком «${conflict.name}»`);
}
function ownerBounds(plan: D.WarehousePlanDto, e: D.EntranceDto): Box {
  if (plan.layoutMode === "rectangle") {
    if (e.spaceId !== null)
      reject("В прямоугольном режиме вход не должен быть привязан к участку");
    return { x: 0, y: 0, width: plan.width, depth: plan.depth };
  }
  if (!e.spaceId)
    reject(
      "В режиме участков вход должен быть привязан к помещению или коридору",
    );
  const space = plan.spaces.find(
    (space) => space.id === e.spaceId && !space.archived,
  );
  if (!space) reject("Участок входа не найден или находится в архиве");
  return space;
}
export function doorSegment(
  box: Box,
  e: Pick<D.EntranceDto, "wall" | "offset" | "width">,
): DoorSegment {
  switch (e.wall) {
    case "north":
      return {
        axis: "horizontal",
        line: box.y,
        start: box.x + e.offset,
        end: box.x + e.offset + e.width,
      };
    case "south":
      return {
        axis: "horizontal",
        line: box.y + box.depth,
        start: box.x + e.offset,
        end: box.x + e.offset + e.width,
      };
    case "west":
      return {
        axis: "vertical",
        line: box.x,
        start: box.y + e.offset,
        end: box.y + e.offset + e.width,
      };
    case "east":
      return {
        axis: "vertical",
        line: box.x + box.width,
        start: box.y + e.offset,
        end: box.y + e.offset + e.width,
      };
    default:
      return reject("Неизвестная стена входа");
  }
}
export function globalDoorSegment(plan: D.WarehousePlanDto, e: D.EntranceDto) {
  return doorSegment(ownerBounds(plan, e), e);
}
export function checkEntrance(s: D.WorkspaceDto, e: D.EntranceDto) {
  if (
    !["north", "east", "south", "west"].includes(e.wall) ||
    !Number.isFinite(e.offset) ||
    !Number.isFinite(e.width) ||
    e.offset < 0 ||
    e.width < 0.5
  )
    reject("Неверные параметры входа");
  const owner = ownerBounds(s.warehouse, e);
  const limit = ["north", "south"].includes(e.wall) ? owner.width : owner.depth;
  if (e.offset + e.width > limit + epsilon)
    reject("Вход выходит за пределы выбранной стены");
  const segment = doorSegment(owner, e);
  const duplicate = s.entrances.find((other) => {
    if (other.id === e.id || other.archived) return false;
    const otherSegment = globalDoorSegment(s.warehouse, other);
    return (
      segment.axis === otherSegment.axis &&
      Math.abs(segment.line - otherSegment.line) <= epsilon &&
      segment.start < otherSegment.end - epsilon &&
      segment.end > otherSegment.start + epsilon
    );
  });
  if (duplicate)
    reject(
      "Входы не должны перекрываться: физический проём уже существует на этой стене",
    );
}
export function checkPlanState(s: D.WorkspaceDto) {
  if (!["rectangle", "spaces"].includes(s.warehouse.layoutMode))
    reject("Неизвестный режим плана");
  for (const space of s.warehouse.spaces.filter((space) => !space.archived))
    checkSpace(s.warehouse, space);
  for (const rect of [
    ...s.sections.filter((x) => !x.archived),
    ...s.locations.filter((x) => !x.archived && !x.sectionId),
  ])
    checkBounds(s.warehouse, rect);
  for (const aisle of s.aisles.filter((x) => !x.archived))
    checkBounds(s.warehouse, aisle, 0.5);
  for (const entrance of s.entrances.filter((x) => !x.archived))
    checkEntrance(s, entrance);
}
/** Exact segment binding only: no nearest-wall inference or movement of existing openings. */
export function legacyDoorBinding(
  plan: D.WarehousePlanDto,
  e: D.EntranceDto,
  space: D.WarehouseSpaceDto,
): Pick<D.EntranceDto, "wall" | "offset" | "spaceId"> | null {
  const old = doorSegment(
    { x: 0, y: 0, width: plan.width, depth: plan.depth },
    e,
  );
  for (const wall of ["north", "east", "south", "west"]) {
    const base = doorSegment(space, {
      wall,
      offset: 0,
      width: ["north", "south"].includes(wall) ? space.width : space.depth,
    });
    if (
      base.axis === old.axis &&
      Math.abs(base.line - old.line) <= epsilon &&
      old.start >= base.start - epsilon &&
      old.end <= base.end + epsilon
    )
      return {
        wall,
        offset: Math.max(0, old.start - base.start),
        spaceId: space.id,
      };
  }
  return null;
}
export function geometryChanged(a: Rect, b: Rect) {
  return (["x", "y", "width", "depth", "rotation"] as const).some(
    (key) => a[key] !== b[key],
  );
}
