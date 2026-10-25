import assert from "node:assert/strict";
import { test } from "node:test";
import type { LocationDto, WorkRouteDto } from "@/shared/api/generated/model";
import type { LocationMapData } from "./location-map";
import {
  createWorkRouteMap,
  workRouteBounds,
  workRouteRequestKey,
} from "./work-route";

const place = (id: string, x: number): LocationDto => ({
  id,
  code: id.toUpperCase(),
  name: id,
  kind: "floor",
  sectionId: null,
  level: 1,
  x,
  y: 1,
  width: 1,
  depth: 2,
  rotation: 0,
  archived: false,
  archivedAt: null,
  availableWidthMm: 1000,
  availableDepthMm: 2000,
  maxWeightKg: null,
  accessSides: 4,
  levels: 1,
  maxHeightMm: 2000,
  maxBoxes: 18,
  blocked: false,
});
const data = (): LocationMapData => ({
  revision: 5,
  warehouse: {
    name: "Склад",
    width: 30,
    depth: 30,
    layoutMode: "rectangle",
    spaces: [],
    workZones: [],
    zoneWork: [],
  },
  locations: [place("from", 1), place("to", 10)],
  sections: [],
  aisles: [],
  entrances: [],
});
const route = (values: Partial<WorkRouteDto> = {}): WorkRouteDto => ({
  revision: 5,
  layoutKey: "layout-1",
  sourceLocationId: "from",
  targetLocationId: "to",
  status: "aisles",
  distanceMeters: 25,
  note: "",
  points: [
    { x: 2, y: 2 },
    { x: 2, y: 15 },
    { x: 10, y: 15 },
    { x: 10, y: 2 },
  ],
  ...values,
});

test("route view fits detours and endpoint footprints instead of direct endpoint line", () => {
  const result = createWorkRouteMap(data(), route(), "layout-1");
  assert.ok(result.available);
  assert.deepEqual(result.line, route().points);
  assert.ok(result.bounds.y + result.bounds.depth > 15);
  assert.ok(result.bounds.x < 1);
  assert.ok(result.bounds.x + result.bounds.width > 11);
});
test("unknown and unreachable paths retain addresses but never invent a line", () => {
  for (const status of ["unknown", "unreachable"] as const) {
    const result = createWorkRouteMap(data(), route({ status }), "layout-1");
    assert.ok(result.available);
    assert.equal(result.line, null);
    assert.ok(result.bounds.depth < 5);
  }
});
test("layout changes reject a path while unrelated stock revisions keep it", () => {
  const stale = createWorkRouteMap(data(), route(), "layout-2");
  assert.equal(stale.available, false);
  assert.ok(!stale.available && stale.reason === "layout");
  const current = createWorkRouteMap(
    data(),
    route({ revision: 4 }),
    "layout-1",
  );
  assert.ok(current.available && current.line);
});
test("archived source, destination or source section prevents route rendering", () => {
  for (const id of ["from", "to"]) {
    const state = data();
    state.locations.find((item) => item.id === id)!.archived = true;
    assert.equal(
      createWorkRouteMap(state, route(), "layout-1").available,
      false,
    );
  }
  const state = data();
  state.locations[0].sectionId = "old-section";
  assert.equal(createWorkRouteMap(state, route(), "layout-1").available, false);
});
test("invalid route points suppress the path without hiding valid addresses", () => {
  for (const points of [
    [],
    [{ x: 2, y: 2 }],
    [
      { x: 2, y: 2 },
      { x: Number.NaN, y: 3 },
    ],
  ]) {
    const result = createWorkRouteMap(data(), route({ points }), "layout-1");
    assert.ok(result.available);
    assert.equal(result.line, null);
  }
});
test("vertical and zero-distance views have positive readable extents", () => {
  const bounds = workRouteBounds(
    [
      { x: 4, y: 1 },
      { x: 4, y: 8 },
    ],
    [],
  );
  assert.ok(bounds.width >= 1.2);
  assert.ok(bounds.depth > 7);
  const same = workRouteBounds([], [{ x: 4, y: 1, width: 1, depth: 2 }]);
  assert.ok(same.width > 1 && same.depth > 2);
});
test("query identity changes for kind, job, selected pallet or selected box", () => {
  const base = {
    kind: "receiving" as const,
    id: "receipt",
    palletId: "pallet",
  };
  assert.equal(workRouteRequestKey(base), workRouteRequestKey({ ...base }));
  const keys = [
    base,
    { ...base, id: "another" },
    { ...base, palletId: "other" },
    { ...base, boxId: "box" },
    { ...base, kind: "assembly" as const },
  ].map(workRouteRequestKey);
  assert.equal(new Set(keys).size, keys.length);
});

test("a route from a newer task endpoint cannot contradict the current scan address", () => {
  const wrong = createWorkRouteMap(data(), route(), "layout-1", {
    intent: "place",
    locationId: "another-address",
  });
  assert.ok(!wrong.available && wrong.reason === "work");
  const correct = createWorkRouteMap(data(), route(), "layout-1", {
    intent: "take",
    locationId: "from",
  });
  assert.ok(correct.available && correct.line);
});
