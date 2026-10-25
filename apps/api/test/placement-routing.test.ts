import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import type * as D from "../src/dto";
import {
  MAX_LOCAL_ACCESS_METERS,
  PLACEMENT_ROUTING_LIMITS,
  placementRoutes,
  placementRoutePath,
} from "../src/placement-routing";

type Plan = Parameters<typeof placementRoutes>[0];
const archive = { archived: false, archivedAt: null };
const location = (
  id: string,
  x: number,
  y: number,
  width = 1,
  depth = 1,
  extra: Partial<D.LocationDto> = {},
): D.LocationDto => ({
  ...archive,
  id,
  code: id,
  name: id,
  kind: "floor",
  x,
  y,
  width,
  depth,
  rotation: 0,
  sectionId: null,
  level: 0,
  levels: 1,
  availableWidthMm: width * 1000,
  availableDepthMm: depth * 1000,
  maxWeightKg: null,
  accessSides: 1,
  maxHeightMm: 3000,
  maxBoxes: 18,
  blocked: false,
  ...extra,
});
const aisle = (
  id: string,
  x: number,
  y: number,
  width: number,
  depth: number,
): D.AisleDto => ({
  ...archive,
  id,
  name: id,
  x,
  y,
  width,
  depth,
  rotation: 0,
});
const room = (
  id: string,
  x: number,
  y: number,
  width: number,
  depth: number,
  kind = "room",
): D.WarehouseSpaceDto => ({
  ...archive,
  id,
  name: id,
  x,
  y,
  width,
  depth,
  kind,
});
const entrance = (
  spaceId: string,
  wall: string,
  offset: number,
  width = 1,
): D.EntranceDto => ({
  ...archive,
  id: `${spaceId}:${wall}`,
  name: "Дверь",
  spaceId,
  wall,
  offset,
  width,
});
function plan(locations: D.LocationDto[], extra: Partial<Plan> = {}): Plan {
  return {
    warehouse: {
      name: "Тест",
      layoutMode: "rectangle",
      width: 12,
      depth: 10,
      spaces: [],
      workZones: [],
      zoneWork: [],
    },
    locations,
    sections: [],
    aisles: [],
    entrances: [],
    ...extra,
  };
}
function spaces(s: Plan, rooms: D.WarehouseSpaceDto[]) {
  s.warehouse.layoutMode = "spaces";
  s.warehouse.spaces = rooms;
  return s;
}
const route = (s: Plan, target = "target", source: string | null = "source") =>
  placementRoutes(s, source, [target]).get(target)!;

test("floor fallback measures perimeter access, not centres or fixed midpoint detours", () => {
  const s = plan([
    location("source", 1, 2, 2, 2),
    location("target", 3.2, 2, 2, 2),
  ]);
  const result = route(s);
  assert.equal(result.status, "floor");
  assert.equal(result.distanceMeters, 0.2);
  assert.match(result.note, /свободному полу/);
  const before = JSON.stringify(s);
  placementRoutes(s, "source", ["target", "source", "target"]);
  assert.equal(JSON.stringify(s), before);
});

test("the aisle network follows a U-shaped detour rather than a straight floor shortcut", () => {
  const s = plan([location("source", 1, 6), location("target", 9, 6)], {
    aisles: [
      aisle("left", 2, 1, 1, 6),
      aisle("right", 8, 1, 1, 6),
      aisle("top", 2, 1, 7, 1),
    ],
  });
  const result = route(s);
  assert.equal(result.status, "aisles");
  assert.ok(result.distanceMeters! >= 14, JSON.stringify(result));
  assert.match(result.note, /отмеченным проходам/);
});

test("nearby addresses on disconnected aisles are unreachable, with no endpoint transit bridge", () => {
  const s = plan([location("source", 1, 3), location("target", 9, 3)], {
    aisles: [aisle("left", 2, 1, 1, 6), aisle("right", 8, 1, 1, 6)],
  });
  assert.equal(route(s).status, "unreachable");
  // A third candidate between both networks is only a terminal, never a bridge.
  s.locations.push(location("middle", 4.5, 3, 2, 1));
  const results = placementRoutes(s, "source", ["middle", "target"]);
  assert.equal(results.get("middle")!.status, "aisles");
  assert.equal(results.get("target")!.status, "unreachable");
});

test("an endpoint beyond the bounded aisle approach is unknown, not physically unreachable", () => {
  assert.equal(MAX_LOCAL_ACCESS_METERS, 2);
  const s = plan([location("source", 1, 3), location("target", 8, 3)], {
    aisles: [aisle("left", 2, 1, 1, 6)],
  });
  assert.equal(route(s).status, "unknown");
  assert.match(route(s).note, /короткого подхода/);
  assert.equal(route(s, "source", "target").status, "unknown");
});

test("shared walls are closed until a real door exists; one door opens both adjoining rooms", () => {
  const s = spaces(plan([location("source", 1, 1), location("target", 9, 1)]), [
    room("left", 0, 0, 6, 8),
    room("right", 6, 0, 6, 8),
  ]);
  assert.equal(route(s).status, "unreachable");
  s.entrances = [entrance("left", "east", 6)];
  const leftDoor = route(s);
  assert.equal(leftDoor.status, "floor");
  assert.ok(leftDoor.distanceMeters! > 12, JSON.stringify(leftDoor));
  s.entrances = [entrance("right", "west", 6)];
  assert.deepEqual(route(s), leftDoor);
  s.entrances[0].archived = true;
  assert.equal(route(s).status, "unreachable");
});

test("corner contact, a gap, and an exterior doorway never connect rooms", () => {
  for (const next of [
    room("other", 4, 4, 4, 4),
    room("other", 4.01, 0, 4, 4),
  ]) {
    const s = spaces(
      plan([
        location("source", 1, 1),
        location("target", next.x + 1, next.y + 1),
      ]),
      [room("first", 0, 0, 4, 4), next],
    );
    s.entrances = [entrance("first", "east", 3)];
    assert.equal(route(s).status, "unreachable");
  }
  const s = spaces(plan([location("source", 1, 1), location("target", 5, 1)]), [
    room("first", 0, 0, 4, 4),
    room("second", 4, 0, 4, 4),
  ]);
  s.entrances = [entrance("first", "north", 2)];
  assert.equal(route(s).status, "unreachable");
});

test("a partly blocked wide doorway remains usable through its open positive-width portion", () => {
  const s = spaces(
    plan([
      location("source", 1, 1),
      location("target", 9, 1),
      location("door-obstacle", 5, 3, 1, 2),
    ]),
    [room("left", 0, 0, 6, 8), room("right", 6, 0, 6, 8)],
  );
  s.entrances = [entrance("left", "east", 2, 4)];
  const result = route(s);
  assert.equal(result.status, "floor");
  assert.ok(result.distanceMeters! < 10, JSON.stringify(result));
  s.locations[2].y = 2;
  s.locations[2].depth = 4;
  assert.equal(route(s).distanceMeters, null);
});

test("blocked physical locations force a floor detour; archived ones stop blocking", () => {
  const s = plan([
    location("source", 1, 4),
    location("target", 9, 4),
    location("obstacle", 4, 0, 2, 8, { blocked: true }),
  ]);
  const detour = route(s);
  assert.equal(detour.status, "floor");
  assert.ok(detour.distanceMeters! >= 12, JSON.stringify(detour));
  s.locations[2].archived = true;
  const direct = route(s);
  assert.equal(direct.distanceMeters, 7);
  assert.ok(direct.distanceMeters! < detour.distanceMeters!);
});

test("diagonally touching free regions cannot squeeze through an obstacle corner", () => {
  const s = plan([
    location("source", 1, 1),
    location("target", 4, 4),
    location("top-right", 3, 0, 3, 3),
    location("bottom-left", 0, 3, 3, 3),
  ]);
  s.warehouse.width = 6;
  s.warehouse.depth = 6;
  assert.equal(route(s).status, "unreachable");
});

test("rotated rack levels are one physical blocker; archived levels and sections do not invent geometry", () => {
  const section: D.RackSectionDto = {
    ...archive,
    id: "rack",
    code: "A-01",
    name: "Стеллаж",
    x: 4,
    y: 0,
    width: 8,
    depth: 2,
    rotation: 90,
    archivedLocationIds: [],
  };
  const s = plan(
    [
      location("source", 1, 4),
      location("target", 9, 4),
      location("level-1", 4, 0, 8, 2, {
        sectionId: "rack",
        level: 1,
        rotation: 90,
      }),
      location("level-2", 4, 0, 8, 2, {
        sectionId: "rack",
        level: 2,
        rotation: 90,
      }),
    ],
    { sections: [section] },
  );
  const first = route(s);
  assert.equal(first.status, "floor");
  assert.ok(first.distanceMeters! >= 12);
  s.locations[3].archived = true;
  assert.deepEqual(route(s), first);
  section.width = 2;
  section.depth = 8;
  section.rotation = 0;
  assert.deepEqual(route(s), first);
  section.archived = true;
  assert.equal(route(s).distanceMeters, 7);
  assert.equal(route(s, "level-1").status, "unknown");
});

test("short door approaches connect aisle rooms through an open corridor even with a drawn corridor aisle", () => {
  const s = spaces(
    plan([location("source", 0.5, 3), location("target", 13, 3)]),
    [
      room("left", 0, 0, 6, 8),
      room("hall", 6, 0, 3, 8, "corridor"),
      room("right", 9, 0, 6, 8),
    ],
  );
  s.warehouse.width = 15;
  s.aisles = [
    aisle("left", 2, 0, 3, 8),
    aisle("right", 10, 0, 3, 8),
    aisle("hall-marker", 7, 0, 0.5, 1),
  ];
  s.entrances = [entrance("left", "east", 3), entrance("hall", "east", 3)];
  const result = route(s);
  assert.equal(result.status, "aisles");
  assert.ok(result.distanceMeters! > 0);
  assert.ok(Number.isFinite(result.distanceMeters));
});

test("a door without bounded aisle access yields unknown instead of claiming an impossible route", () => {
  const s = spaces(plan([location("source", 1, 1), location("target", 9, 1)]), [
    room("left", 0, 0, 6, 8),
    room("right", 6, 0, 6, 8),
  ]);
  s.aisles = [aisle("left", 2, 1, 1, 2), aisle("right", 8, 1, 1, 2)];
  s.entrances = [entrance("left", "east", 6)];
  assert.equal(route(s).status, "unknown");
});

test("missing, archived and malformed geometry is unknown and routes never mutate input", () => {
  const s = plan([location("source", 1, 1), location("target", 6, 1)]);
  assert.equal(route(s, "missing").status, "unknown");
  assert.equal(route(s, "target", null).status, "unknown");
  s.locations[1].archived = true;
  assert.equal(route(s).status, "unknown");
  s.locations[1].archived = false;
  s.locations[1].width = Number.NaN;
  assert.equal(route(s).status, "unknown");
});

test("candidate and compressed-grid caps return unknown, never unreachable or a fake straight route", () => {
  const s = plan([location("source", 1, 1), location("target", 6, 1)]);
  const huge = placementRoutes(
    s,
    "source",
    Array.from(
      { length: PLACEMENT_ROUTING_LIMITS.candidates + 1 },
      (_, i) => `x${i}`,
    ),
  );
  assert.equal(huge.size, PLACEMENT_ROUTING_LIMITS.candidates + 1);
  assert.ok(
    [...huge.values()].every(
      (r) => r.status === "unknown" && r.distanceMeters === null,
    ),
  );
  s.warehouse.width = 20;
  s.warehouse.depth = 20;
  for (let i = 0; i < 120; i++)
    s.locations.push(
      location(`dense-${i}`, 1 + i * 0.08, 1 + i * 0.08, 0.04, 0.04),
    );
  const limited = route(s);
  assert.equal(limited.status, "unknown");
  assert.match(limited.note, /лимит/);
});

type Point = { x: number; y: number };
const manhattan = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
function checkedPath(s: Plan, source = "source", target = "target") {
  const before = JSON.stringify(s);
  const result = placementRoutePath(s, source, target);
  const { points, ...summary } = result;
  assert.deepEqual(
    summary,
    route(s, target, source),
    "tracing preserves ranking",
  );
  assert.equal(JSON.stringify(s), before, "read-only projection");
  if (result.distanceMeters === null || result.distanceMeters === 0) {
    assert.deepEqual(points, []);
    return result;
  }
  assert.ok(points.length >= 2, JSON.stringify(result));
  const blockers = [
    ...s.sections.filter((r) => !r.archived),
    ...s.locations.filter((r) => !r.archived && !r.sectionId),
  ].map((r) => ({
    ...r,
    width: r.rotation % 180 ? r.depth : r.width,
    depth: r.rotation % 180 ? r.width : r.depth,
  }));
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
    assert.ok(
      Math.abs(a.x - b.x) < 1e-8 || Math.abs(a.y - b.y) < 1e-8,
      "no diagonal shortcut",
    );
    assert.ok(manhattan(a, b) > 1e-8, "no duplicate adjacent points");
    length += manhattan(a, b);
    for (const rect of blockers) {
      const crosses =
        Math.abs(a.y - b.y) < 1e-8
          ? a.y > rect.y + 1e-8 &&
            a.y < rect.y + rect.depth - 1e-8 &&
            Math.min(Math.max(a.x, b.x), rect.x + rect.width) >
              Math.max(Math.min(a.x, b.x), rect.x) + 1e-8
          : a.x > rect.x + 1e-8 &&
            a.x < rect.x + rect.width - 1e-8 &&
            Math.min(Math.max(a.y, b.y), rect.y + rect.depth) >
              Math.max(Math.min(a.y, b.y), rect.y) + 1e-8;
      assert.equal(
        crosses,
        false,
        `segment ${JSON.stringify([a, b])} crosses ${rect.id}`,
      );
    }
  }
  assert.ok(
    Math.abs(length - result.distanceMeters) <= 0.01,
    `${length} ≠ ${result.distanceMeters}`,
  );
  return result;
}

test("trace starts/ends on address perimeters and ranking never includes polylines", () => {
  const s = plan([
    location("source", 1, 2, 2, 2),
    location("target", 3.2, 2, 2, 2),
  ]);
  const path = checkedPath(s);
  assert.deepEqual(path.points, [
    { x: 3, y: 2 },
    { x: 3.2, y: 2 },
  ]);
  assert.ok(
    [...placementRoutes(s, "source", ["source", "target"]).values()].every(
      (r) => !("points" in r),
    ),
  );
});

test("trace follows a U-shaped aisle detour in both directions", () => {
  const s = plan([location("source", 1, 6), location("target", 9, 6)], {
    aisles: [
      aisle("left", 2, 1, 1, 6),
      aisle("right", 8, 1, 1, 6),
      aisle("top", 2, 1, 7, 1),
    ],
  });
  for (const [from, to] of [
    ["source", "target"],
    ["target", "source"],
  ]) {
    const path = checkedPath(s, from, to);
    assert.equal(path.status, "aisles");
    assert.ok(
      path.points.some((p) => p.y <= 2),
      "reach connecting top aisle",
    );
    assert.ok(path.distanceMeters! >= 14);
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1],
        b = path.points[i];
      if (Math.min(a.x, b.x) < 8 && Math.max(a.x, b.x) > 3)
        assert.ok(
          a.y <= 2 && b.y <= 2,
          "cross-room segment stays in top aisle",
        );
    }
  }
});

test("traced doors reverse correctly and cross shared walls only through openings", () => {
  const s = spaces(plan([location("source", 1, 1), location("target", 9, 1)]), [
    room("left", 0, 0, 6, 8),
    room("right", 6, 0, 6, 8),
  ]);
  s.entrances = [entrance("left", "east", 6)];
  for (const [from, to] of [
    ["source", "target"],
    ["target", "source"],
  ]) {
    const path = checkedPath(s, from, to);
    assert.ok(
      path.points.some((p) => Math.abs(p.x - 6) < 1e-8 && p.y >= 6 && p.y <= 7),
    );
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1],
        b = path.points[i];
      if (Math.min(a.x, b.x) < 6 - 1e-8 && Math.max(a.x, b.x) > 6 + 1e-8)
        assert.ok(a.y >= 6 && a.y <= 7, "no solid wall crossing");
    }
  }
  s.entrances = [];
  assert.equal(checkedPath(s).status, "unreachable");
});

test("trace avoids rotated equipment and blocked parts of wide doorways", () => {
  const s = spaces(
    plan([
      location("source", 1, 1),
      location("target", 9, 1),
      location("obstacle", 5, 3, 2, 1, { rotation: 90 }),
    ]),
    [room("left", 0, 0, 6, 8), room("right", 6, 0, 6, 8)],
  );
  s.entrances = [entrance("left", "east", 2, 4)];
  checkedPath(s);
  checkedPath(s, "target", "source");
  const detour = plan([
    location("source", 1, 4),
    location("target", 9, 4),
    location("rotated-rack", 4, 0, 8, 2, { rotation: 270, blocked: true }),
  ]);
  assert.ok(checkedPath(detour).points.some((p) => p.y >= 8));
});

test("mixed aisle/corridor trace has connected orthogonal door approaches", () => {
  const s = spaces(
    plan([location("source", 0.5, 3), location("target", 13, 3)]),
    [
      room("left", 0, 0, 6, 8),
      room("hall", 6, 0, 3, 8, "corridor"),
      room("right", 9, 0, 6, 8),
    ],
  );
  s.warehouse.width = 15;
  s.aisles = [aisle("left", 2, 0, 3, 8), aisle("right", 10, 0, 3, 8)];
  s.entrances = [entrance("left", "east", 3), entrance("hall", "east", 3)];
  assert.equal(checkedPath(s).status, "aisles");
  checkedPath(s, "target", "source");
});

test("same rack levels have zero horizontal distance without invented vertical path", () => {
  const section: D.RackSectionDto = {
    ...archive,
    id: "rack",
    code: "A",
    name: "Стеллаж",
    x: 3,
    y: 3,
    width: 2,
    depth: 1,
    rotation: 90,
    archivedLocationIds: [],
  };
  const s = plan(
    [
      location("source", 3, 3, 2, 1, { sectionId: "rack", level: 1 }),
      location("target", 3, 3, 2, 1, { sectionId: "rack", level: 3 }),
    ],
    { sections: [section] },
  );
  const result = checkedPath(s);
  assert.equal(result.distanceMeters, 0);
  assert.match(result.note, /ярус/);
});

test("unknown, disconnected and capped traces never invent straight paths", () => {
  const s = plan([location("source", 1, 3), location("target", 9, 3)], {
    aisles: [aisle("left", 2, 1, 1, 6), aisle("right", 8, 1, 1, 6)],
  });
  assert.equal(checkedPath(s).status, "unreachable");
  assert.deepEqual(placementRoutePath(s, null, "target").points, []);
  assert.deepEqual(placementRoutePath(s, "source", null).points, []);
  assert.equal(checkedPath(s, "source", "missing").status, "unknown");
  s.aisles = [aisle("left", 2, 1, 1, 6)];
  assert.equal(checkedPath(s).status, "unknown");
  s.aisles = [];
  s.warehouse.width = 20;
  s.warehouse.depth = 20;
  for (let i = 0; i < 120; i++)
    s.locations.push(
      location(`dense-${i}`, 1 + i * 0.08, 1 + i * 0.08, 0.04, 0.04),
    );
  const capped = checkedPath(s);
  assert.equal(capped.status, "unknown");
  assert.match(capped.note, /лимит/);
});
