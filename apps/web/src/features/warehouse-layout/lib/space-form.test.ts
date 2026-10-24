import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  WarehousePlanDto,
  WarehouseSpaceDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import {
  spaceArchiveReasons,
  spaceDefaults,
  spaceSchema,
  spaceSchemaFor,
  toSpace,
} from "./space-form";

function area(
  id = "room",
  overrides: Partial<WarehouseSpaceDto> = {},
): WarehouseSpaceDto {
  return {
    id,
    name: "Помещение",
    kind: "room",
    x: 0,
    y: 0,
    width: 10,
    depth: 10,
    archived: false,
    archivedAt: null,
    ...overrides,
  };
}
function plan(): WarehousePlanDto {
  return {
    name: "План",
    width: 30.2,
    depth: 20.1,
    layoutMode: "spaces",
    spaces: [area()],
  };
}
function workspace(): WorkspaceDto {
  return {
    receipts: [],
    putawayTasks: [],
    balance: {
      rawUnits: 0,
      workInProgressUnits: 0,
      boxedUnits: 0,
      totalUnits: 0,
      awaitingPlacementUnits: 0,
      awaitingPlacementPallets: 0,
    },
    revision: 0,
    warehouse: plan(),
    sections: [],
    locations: [],
    aisles: [],
    entrances: [],
    pallets: [],
    boxes: [],
    skus: [],
    lots: [],
    tasks: [],
    employees: [],
    shipments: [],
    movements: [],
    activities: [],
  };
}

test("точные размеры участка сохраняются без snap, ID и архивные поля не отправляются", () => {
  const values = spaceSchema.parse({
    name: "Комната",
    kind: "room",
    x: 10.12,
    y: 3.27,
    width: 4.37,
    depth: 2.19,
    id: "client-id",
    archived: true,
  });
  const withUnexpectedFields = { ...values, id: "injected", archived: true };
  const dto = toSpace(withUnexpectedFields);
  assert.deepEqual(
    [dto.x, dto.y, dto.width, dto.depth],
    [10.12, 3.27, 4.37, 2.19],
  );
  assert.equal("id" in dto, false);
  assert.equal("archived" in dto, false);
  assert.equal(
    spaceSchema.safeParse({ ...values, width: 0.49 }).success,
    false,
  );
  for (const invalid of [NaN, Infinity, -Infinity])
    assert.equal(
      spaceSchema.safeParse({ ...values, x: invalid }).success,
      false,
    );
});

test("черновик от рисования переносится в форму, редактирование сохраняет серверную геометрию", () => {
  const draft = {
    kind: "corridor" as const,
    x: 1.5,
    y: 2.5,
    width: 3,
    depth: 0.5,
  };
  assert.deepEqual(spaceDefaults(undefined, draft), { name: "", ...draft });
  assert.equal(spaceDefaults(area("saved", { width: 8.7 }), draft).width, 8.7);
});

test("касание участков разрешено, пересечение и выход за canvas отклоняются", () => {
  const warehouse = plan();
  const values = {
    name: "Коридор",
    kind: "corridor" as const,
    x: 10,
    y: 0,
    width: 1.5,
    depth: 4,
  };
  assert.equal(spaceSchemaFor(warehouse).safeParse(values).success, true);
  assert.equal(
    spaceSchemaFor(warehouse).safeParse({ ...values, x: 9.99 }).success,
    false,
  );
  assert.equal(
    spaceSchemaFor(warehouse).safeParse({ ...values, x: 30, width: 1 }).success,
    false,
  );
  assert.equal(
    spaceSchemaFor(warehouse, "room").safeParse({
      ...spaceDefaults(area()),
      name: "Изменено",
    }).success,
    true,
  );
  warehouse.spaces[0]!.archived = true;
  assert.equal(
    spaceSchemaFor(warehouse).safeParse({ ...values, x: 9.99 }).success,
    true,
  );
});

test("участок защищён активной пустой секцией, адресом, проходом и привязанным входом", () => {
  const data = workspace();
  data.sections.push({
    id: "section",
    code: "A",
    name: "Пустая секция",
    x: 1,
    y: 1,
    width: 2,
    depth: 1,
    rotation: 0,
    archived: false,
    archivedAt: null,
    archivedLocationIds: [],
  });
  data.locations.push({
    id: "address",
    code: "F-1",
    name: "Место",
    kind: "floor",
    sectionId: null,
    level: 1,
    levels: 1,
    x: 4,
    y: 1,
    width: 2,
    depth: 1,
    rotation: 0,
    archived: false,
    archivedAt: null,
    blocked: false,
    maxHeightMm: 1800,
    maxBoxes: 18,
    availableWidthMm: 1300,
    availableDepthMm: 900,
    maxWeightKg: null,
    accessSides: 4,
  });
  data.aisles.push({
    id: "aisle",
    name: "Проход",
    x: 1,
    y: 5,
    width: 2,
    depth: 3,
    rotation: 90,
    archived: false,
    archivedAt: null,
  });
  data.entrances.push({
    id: "entrance",
    name: "Вход",
    spaceId: "room",
    wall: "north",
    offset: 0,
    width: 1.5,
    archived: false,
    archivedAt: null,
  });
  assert.equal(spaceArchiveReasons(data, data.warehouse.spaces[0]!).length, 4);
  data.sections[0]!.archived = true;
  data.locations[0]!.archived = true;
  data.aisles[0]!.archived = true;
  data.entrances[0]!.archived = true;
  assert.deepEqual(spaceArchiveReasons(data, data.warehouse.spaces[0]!), []);
});

test("объект соседнего участка, касающийся стены, не блокирует удаление", () => {
  const data = workspace();
  data.aisles.push({
    id: "neighbour",
    name: "Соседний проход",
    x: 10,
    y: 0,
    width: 1,
    depth: 3,
    rotation: 0,
    archived: false,
    archivedAt: null,
  });
  assert.deepEqual(spaceArchiveReasons(data, data.warehouse.spaces[0]!), []);
});
