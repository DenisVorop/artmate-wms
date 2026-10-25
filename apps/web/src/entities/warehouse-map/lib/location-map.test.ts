import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  EntranceDto,
  LocationDto,
  RackSectionDto,
  WarehouseSpaceDto,
} from "@/shared/api/generated/model";
import {
  createLocationMap,
  mapEntrance,
  mapFootprint,
  type LocationMapData,
} from "./location-map";
const location = (v: Partial<LocationDto> = {}): LocationDto => ({
  id: "a-01-01",
  code: "A-01-01",
  name: "Стеллаж A-01, ярус 1",
  kind: "rack",
  sectionId: "rack-a",
  level: 1,
  x: 11,
  y: 5,
  width: 2,
  depth: 1,
  rotation: 0,
  archived: false,
  archivedAt: null,
  availableWidthMm: 2000,
  availableDepthMm: 1000,
  maxWeightKg: null,
  accessSides: 1,
  levels: 1,
  maxHeightMm: 2000,
  maxBoxes: 18,
  blocked: false,
  ...v,
});
const section = (v: Partial<RackSectionDto> = {}): RackSectionDto => ({
  id: "rack-a",
  code: "A-01",
  name: "Стеллаж A-01",
  x: 11,
  y: 5,
  width: 2,
  depth: 1,
  rotation: 0,
  archived: false,
  archivedAt: null,
  archivedLocationIds: [],
  ...v,
});
const space = (v: Partial<WarehouseSpaceDto> = {}): WarehouseSpaceDto => ({
  id: "room-a",
  name: "Основной склад",
  kind: "room",
  x: 10,
  y: 4,
  width: 8,
  depth: 10,
  archived: false,
  archivedAt: null,
  ...v,
});
const data = (v: Partial<LocationMapData> = {}): LocationMapData => ({
  warehouse: {
    name: "Склад",
    width: 50,
    depth: 50,
    layoutMode: "spaces",
    spaces: [space()],
    workZones: [],
    zoneWork: [],
  },
  locations: [location()],
  sections: [section()],
  aisles: [],
  entrances: [],
  ...v,
});
const entrance = (v: Partial<EntranceDto> = {}): EntranceDto => ({
  id: "door",
  name: "Вход",
  spaceId: "room-a",
  wall: "south",
  offset: 2,
  width: 1,
  archived: false,
  archivedAt: null,
  ...v,
});

test("rotated footprint preserves upper-left coordinates and swaps only at quarter turns", () => {
  for (const rotation of [0, 90, 180, 270])
    assert.deepEqual(
      mapFootprint({ x: 7, y: 8, width: 3, depth: 1, rotation }),
      {
        x: 7,
        y: 8,
        width: rotation % 180 === 90 ? 1 : 3,
        depth: rotation % 180 === 90 ? 3 : 1,
      },
    );
});
test("all levels share one physical section while selected level retains exact identity", () => {
  const result = createLocationMap(
    data({
      sections: [section({ rotation: 90 })],
      locations: [
        location(),
        location({ id: "a-01-02", code: "A-01-02", level: 2 }),
      ],
    }),
    "a-01-02",
  );
  assert.ok(result.available);
  assert.equal(result.shapes.length, 1);
  assert.equal(result.targetShapeId, "rack-a");
  assert.equal(result.location.code, "A-01-02");
  assert.equal(result.detail, "Ярус 2");
  assert.deepEqual(result.target, { x: 11, y: 5, width: 1, depth: 2 });
  assert.equal(result.room?.id, "room-a");
  assert.ok(result.focusedBounds.width < 12);
});
test("floor address fits own corridor; unknown room falls back to whole plan", () => {
  const source = data();
  source.warehouse.spaces.push(
    space({
      id: "corridor",
      name: "Переход",
      kind: "corridor",
      x: 10,
      y: 14,
      width: 8,
      depth: 3,
    }),
  );
  source.locations = [
    location({
      id: "floor",
      code: "PACK-01",
      kind: "assembly",
      sectionId: null,
      x: 12,
      y: 15,
      width: 1,
      depth: 1,
    }),
  ];
  const result = createLocationMap(source, "floor");
  assert.ok(result.available);
  assert.equal(result.room?.id, "corridor");
  assert.equal(result.detail, "Напольное место");
  assert.equal(result.targetShapeId, "floor");
  source.locations[0].x = 35;
  const outside = createLocationMap(source, "floor");
  assert.ok(outside.available);
  assert.equal(outside.room, null);
  assert.deepEqual(outside.focusedBounds, outside.wholeBounds);
});
test("archived or missing address/section never highlights neighboring place", () => {
  assert.equal(createLocationMap(data(), "missing").available, false);
  assert.equal(createLocationMap(data(), null).available, false);
  assert.equal(
    createLocationMap(
      data({ locations: [location({ archived: true })] }),
      "a-01-01",
    ).available,
    false,
  );
  assert.equal(
    createLocationMap(
      data({ sections: [section({ archived: true })] }),
      "a-01-01",
    ).available,
    false,
  );
  assert.equal(
    createLocationMap(data({ sections: [] }), "a-01-01").available,
    false,
  );
  assert.equal(
    createLocationMap(
      data({ sections: [section({ width: Number.NaN })] }),
      "a-01-01",
    ).available,
    false,
  );
});
test("archived neighbors omitted while active standalone locations stay visible", () => {
  const result = createLocationMap(
    data({
      sections: [section(), section({ id: "old", archived: true })],
      locations: [
        location(),
        location({ id: "old-floor", sectionId: null, archived: true }),
        location({
          id: "floor",
          code: "IN-01",
          kind: "receiving",
          sectionId: null,
        }),
      ],
      aisles: [
        {
          id: "old-aisle",
          name: "Старый проход",
          archived: true,
          archivedAt: null,
          x: 10,
          y: 4,
          width: 1,
          depth: 5,
          rotation: 0,
        },
      ],
    }),
    "a-01-01",
  );
  assert.ok(result.available);
  assert.deepEqual(
    result.shapes.map((item) => item.id),
    ["rack-a", "floor"],
  );
  assert.deepEqual(result.aisles, []);
});
test("doorways use own room offset on every wall and ignore archived/missing room", () => {
  const source = data();
  assert.deepEqual(mapEntrance(entrance(), source), {
    x1: 12,
    y1: 14,
    x2: 13,
    y2: 14,
  });
  assert.deepEqual(mapEntrance(entrance({ wall: "north" }), source), {
    x1: 12,
    y1: 4,
    x2: 13,
    y2: 4,
  });
  assert.deepEqual(mapEntrance(entrance({ wall: "west" }), source), {
    x1: 10,
    y1: 6,
    x2: 10,
    y2: 7,
  });
  assert.deepEqual(mapEntrance(entrance({ wall: "east" }), source), {
    x1: 18,
    y1: 6,
    x2: 18,
    y2: 7,
  });
  assert.equal(mapEntrance(entrance({ archived: true }), source), null);
  assert.equal(mapEntrance(entrance({ spaceId: "missing" }), source), null);
  source.warehouse.spaces[0].archived = true;
  assert.equal(mapEntrance(entrance(), source), null);
});
test("rectangle layouts use warehouse edges and clamp opening extent", () => {
  const source = data();
  source.warehouse.layoutMode = "rectangle";
  assert.deepEqual(
    mapEntrance(entrance({ wall: "east", offset: 49.5, width: 2 }), source),
    { x1: 50, y1: 49.5, x2: 50, y2: 50 },
  );
  const result = createLocationMap(source, "a-01-01");
  assert.ok(result.available);
  assert.equal(result.room?.name, "Склад");
});

test("spaces overview fits real rooms instead of unused editor extent", () => {
  const source = data();
  source.warehouse.width = 500;
  source.warehouse.depth = 800;
  const result = createLocationMap(source, "a-01-01");
  assert.ok(result.available);
  assert.ok(result.wholeBounds.width < 12);
  assert.ok(result.wholeBounds.depth < 14);
  assert.deepEqual(result.wholeBounds, result.focusedBounds);
  assert.ok(result.wholeBounds.x > 9);
  assert.ok(result.wholeBounds.y > 3);
});
