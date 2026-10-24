import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AisleDto,
  LocationDto,
  RackSectionDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import {
  spaceContainsObject,
  workspaceWithSpacePreview,
} from "./space-preview";
import { entranceCenter, planWallLines } from "./plan-geometry";

type Scene = Pick<
  WorkspaceDto,
  | "warehouse"
  | "sections"
  | "locations"
  | "aisles"
  | "pallets"
  | "boxes"
  | "movements"
  | "putawayTasks"
>;
function location(
  id: string,
  overrides: Partial<LocationDto> = {},
): LocationDto {
  return {
    id,
    code: id,
    name: id,
    kind: "floor",
    sectionId: null,
    level: 1,
    levels: 1,
    x: 3,
    y: 4,
    width: 1.3,
    depth: 0.9,
    rotation: 0,
    archived: false,
    archivedAt: null,
    availableWidthMm: 1300,
    availableDepthMm: 900,
    maxHeightMm: 2000,
    maxBoxes: 18,
    maxWeightKg: null,
    accessSides: 1,
    blocked: false,
    ...overrides,
  };
}
function section(
  id: string,
  overrides: Partial<RackSectionDto> = {},
): RackSectionDto {
  return {
    id,
    code: id,
    name: id,
    x: 4,
    y: 4,
    width: 2,
    depth: 1,
    rotation: 0,
    archived: false,
    archivedAt: null,
    archivedLocationIds: [],
    ...overrides,
  };
}
function aisle(id: string, overrides: Partial<AisleDto> = {}): AisleDto {
  return {
    id,
    name: id,
    x: 3,
    y: 5.2,
    width: 1,
    depth: 1,
    rotation: 0,
    archived: false,
    archivedAt: null,
    ...overrides,
  };
}
function scene(): Scene {
  return {
    warehouse: {
      name: "План",
      width: 24,
      depth: 16,
      layoutMode: "spaces",
      spaces: [
        {
          id: "room",
          name: "Помещение",
          kind: "room",
          x: 2,
          y: 3,
          width: 6,
          depth: 4,
          archived: false,
          archivedAt: null,
        },
        {
          id: "neighbor",
          name: "Сосед",
          kind: "corridor",
          x: 12,
          y: 3,
          width: 4,
          depth: 5,
          archived: false,
          archivedAt: null,
        },
      ],
    },
    sections: [
      section("rack"),
      section("rotated", { x: 7, y: 3.5, width: 3, depth: 0.9, rotation: 90 }),
      section("archived-rack", { archived: true }),
    ],
    locations: [
      location("floor"),
      location("child", { sectionId: "rack", kind: "rack", x: 4, y: 4 }),
      location("archived-child", {
        sectionId: "rack",
        kind: "rack",
        x: 4,
        y: 4,
        level: 2,
        archived: true,
      }),
      location("rotated-child", {
        sectionId: "rotated",
        kind: "rack",
        x: 7,
        y: 3.5,
        width: 3,
        depth: 0.9,
        rotation: 90,
      }),
      location("child-of-archived", {
        sectionId: "archived-rack",
        kind: "rack",
      }),
      location("archived-floor", { archived: true }),
      location("partial", { x: 7.5, width: 1 }),
      location("neighbor-floor", { x: 12.2, y: 3.2 }),
    ],
    aisles: [
      aisle("inside"),
      aisle("archived-aisle", { archived: true }),
      aisle("neighbor-aisle", { x: 14, y: 6 }),
    ],
    pallets: [
      {
        id: "physical",
        code: "PLT-1",
        skuId: "sku",
        lotId: "lot",
        kind: "raw",
        status: "stored",
        locationId: "floor",
        returnLocationId: null,
        quantity: 100,
        widthMm: 1200,
        depthMm: 800,
        heightMm: 1400,
        weightKg: null,
        packagingSnapshot: null,
      },
    ],
    boxes: [],
    movements: [],
    putawayTasks: [],
  };
}
function freezeDeep(value: unknown) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.values(value).forEach(freezeDeep);
  Object.freeze(value);
}

test("Групповой preview сдвигает активные секции и все их ярусы ровно один раз; соседние и архивные объекты сохраняются", () => {
  const data = scene(),
    original = structuredClone(data);
  freezeDeep(data);
  const next = workspaceWithSpacePreview(data, {
    id: "space:room",
    x: 4.1,
    y: 5.3,
  });
  assert.deepEqual(next.warehouse.spaces[0], {
    ...data.warehouse.spaces[0],
    x: 4.1,
    y: 5.3,
  });
  assert.equal(next.warehouse.spaces[1], data.warehouse.spaces[1]);
  for (const id of ["rack", "rotated"]) {
    const before = data.sections.find((item) => item.id === id)!,
      after = next.sections.find((item) => item.id === id)!;
    assert.deepEqual(after, {
      ...before,
      x: Number((before.x + 2.1).toFixed(10)),
      y: Number((before.y + 2.3).toFixed(10)),
    });
  }
  for (const id of ["floor", "child", "archived-child", "rotated-child"]) {
    const before = data.locations.find((item) => item.id === id)!,
      after = next.locations.find((item) => item.id === id)!;
    assert.deepEqual(after, {
      ...before,
      x: Number((before.x + 2.1).toFixed(10)),
      y: Number((before.y + 2.3).toFixed(10)),
    });
  }
  for (const id of [
    "child-of-archived",
    "archived-floor",
    "partial",
    "neighbor-floor",
  ])
    assert.equal(
      next.locations.find((item) => item.id === id),
      data.locations.find((item) => item.id === id),
    );
  assert.equal(next.sections[2], data.sections[2]);
  assert.deepEqual(next.aisles[0], { ...data.aisles[0], x: 5.1, y: 7.5 });
  assert.equal(next.aisles[1], data.aisles[1]);
  assert.equal(next.aisles[2], data.aisles[2]);
  assert.deepEqual(data, original);
  for (const key of ["pallets", "boxes", "movements", "putawayTasks"] as const)
    assert.equal(next[key], data[key]);
  assert.equal(next.pallets[0].locationId, "floor");
  // A fresh committed response has this same room origin: keeping a pending preview must not move members twice.
  assert.equal(
    workspaceWithSpacePreview(next, { id: "space:room", x: 4.1, y: 5.3 }),
    next,
  );
});

test("Членство определяется старым rotated footprint с тем же 1e-9 допуском, а не новым положением помещения", () => {
  const data = scene(),
    room = data.warehouse.spaces[0];
  assert.equal(
    spaceContainsObject(room, {
      x: 7,
      y: 3.5,
      width: 3,
      depth: 0.9,
      rotation: 90,
    }),
    true,
  );
  assert.equal(
    spaceContainsObject(room, {
      x: 7,
      y: 3.5,
      width: 3,
      depth: 0.9,
      rotation: 0,
    }),
    false,
  );
  assert.equal(
    spaceContainsObject(room, {
      x: 2 - 5e-10,
      y: 3,
      width: 1,
      depth: 1,
      rotation: 0,
    }),
    true,
  );
  assert.equal(
    spaceContainsObject(room, {
      x: 2 - 2e-9,
      y: 3,
      width: 1,
      depth: 1,
      rotation: 0,
    }),
    false,
  );
  assert.equal(
    spaceContainsObject(room, {
      x: 7 + 5e-10,
      y: 6,
      width: 1,
      depth: 1,
      rotation: 0,
    }),
    true,
  );
  assert.equal(
    spaceContainsObject(room, {
      x: 7 + 2e-9,
      y: 6,
      width: 1,
      depth: 1,
      rotation: 0,
    }),
    false,
  );
  const next = workspaceWithSpacePreview(data, {
    id: "space:room",
    x: 12,
    y: 3,
  });
  assert.equal(
    next.locations.find((item) => item.id === "neighbor-floor"),
    data.locations.find((item) => item.id === "neighbor-floor"),
  );
  assert.equal(next.locations.find((item) => item.id === "floor")?.x, 13);
});

test("Дробная координата неподвижной оси сохраняется точно; коридор переносит своё содержимое и связанный вход", () => {
  const data = scene();
  data.warehouse.spaces[1].y = 3.52345678901;
  data.locations[7].y = 3.62345678901;
  const next = workspaceWithSpacePreview(data, {
    id: "space:neighbor",
    x: 11,
    y: 3.52345678901,
  });
  assert.equal(next.locations[7].x, 11.2);
  assert.equal(next.locations[7].y, 3.62345678901);
  assert.equal(next.locations[0], data.locations[0]);
  const entrance = {
    spaceId: "neighbor",
    wall: "north" as const,
    offset: 1,
    width: 1,
  };
  assert.deepEqual(entranceCenter(entrance, next.warehouse), {
    x: 12.5,
    y: 3.52345678901,
  });
  assert.ok(
    planWallLines(next.warehouse, [entrance]).some(
      (line) => line.x1 === 11 && line.y1 === 3.52345678901,
    ),
  );
  assert.equal(workspaceWithSpacePreview(data, null), data);
  assert.equal(
    workspaceWithSpacePreview(data, { id: "space:missing", x: 1, y: 2 }),
    data,
  );
  assert.equal(
    workspaceWithSpacePreview(data, { id: "aisle:inside", x: 1, y: 2 }),
    data,
  );
  data.warehouse.spaces[1].archived = true;
  assert.equal(
    workspaceWithSpacePreview(data, {
      id: "space:neighbor",
      x: 11,
      y: 3.52345678901,
    }),
    data,
  );
});
