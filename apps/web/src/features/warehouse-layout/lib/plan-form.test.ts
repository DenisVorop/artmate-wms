import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  EntranceDto,
  RackSectionDto,
  WarehousePlanDto,
} from "@/shared/api/generated/model";
import {
  locationDefaults,
  locationSchema,
  profileDefaults,
  toCreateLocation,
  toUpdateLocation,
} from "./location-form";
import {
  newSectionSchema,
  sectionDefaults,
  sectionEditSchema,
  sectionSchema,
  toUpdateSection,
} from "./rack-form";
import {
  aisleDefaults,
  aisleSchema,
  entranceSchemaFor,
  toAisle,
  toEntrance,
  warehousePlanSchema,
  suggestEntrancePosition,
  entranceFrame,
  newEntranceDefaults,
} from "./plan-form";

const room = {
  name: "Склад",
  width: 12.2,
  depth: 8.3,
  workZones: [],
  zoneWork: [],
  layoutMode: "rectangle" as const,
  spaces: [],
};
test("реальные дробные размеры и четыре ориентации проходят форму без привязки к snap", () => {
  const input = {
    ...locationDefaults(),
    code: "F-01",
    name: "Напольное место",
    x: 0.2,
    y: 1.15,
    width: 1.2,
    depth: 2.8,
  };
  for (const rotation of [0, 90, 180, 270]) {
    const values = locationSchema.parse({ ...input, rotation });
    assert.equal(toCreateLocation(values).rotation, rotation);
    assert.equal(toUpdateLocation(values, false).rotation, rotation);
  }
  assert.equal(
    locationSchema.safeParse({ ...input, rotation: 45 }).success,
    false,
  );
  assert.equal(warehousePlanSchema.parse(room).width, 12.2);
});

test("редактирование ограничений яруса не отправляет геометрию и поворот секции", () => {
  const values = {
    ...locationDefaults(),
    code: "A-01-01",
    name: "Ярус 1",
    rotation: 90 as const,
  };
  const dto = toUpdateLocation(values, true);
  for (const key of ["rotation", "x", "y", "width", "depth"])
    assert.equal(key in dto, false);
  assert.equal(dto.code, "A-01-01");
});

test("после удаления последнего яруса пустую секцию можно редактировать, новую пустую создавать нельзя", () => {
  const section: RackSectionDto = {
    id: "section",
    code: "A-01",
    name: "Секция",
    x: 0,
    y: 0,
    width: 3,
    depth: 1.2,
    rotation: 270,
    archived: false,
    archivedAt: null,
    archivedLocationIds: [],
  };
  const values = sectionDefaults(section, []);
  assert.deepEqual(values.levels, []);
  assert.equal(sectionSchema.safeParse(values).success, true);
  assert.equal(
    sectionEditSchema.safeParse({
      ...values,
      levels: [{ code: "", name: "", maxHeightMm: -1 }],
    }).success,
    true,
  );
  assert.equal(newSectionSchema.safeParse(values).success, false);
  assert.equal(toUpdateSection(values).rotation, 270);
});

test("одинаковые адреса двух новых ярусов проверяются без учёта регистра", () => {
  const values = {
    ...sectionDefaults(),
    code: "A",
    name: "Секция",
    levels: [
      { ...profileDefaults(), code: "A-01", name: "Ярус 1" },
      { ...profileDefaults(), code: "a-01", name: "Ярус 2" },
    ],
  };
  const result = newSectionSchema.safeParse(values);
  assert.equal(result.success, false);
  if (!result.success)
    assert.ok(
      result.error.issues.some(
        (issue) => issue.path.join(".") === "levels.1.code",
      ),
    );
});

test("проход допускает ширину 0,5 м и сохраняет размеры и ориентацию", () => {
  assert.deepEqual([aisleDefaults().width, aisleDefaults().depth], [2, 3]);
  const values = aisleSchema.parse({
    ...aisleDefaults(),
    name: "Проход",
    width: 0.5,
    depth: 3.2,
    rotation: 90,
  });
  assert.equal(toAisle(values).rotation, 90);
  assert.equal(toAisle(values).depth, 3.2);
  assert.equal(
    aisleSchema.safeParse({ ...values, width: 0.49 }).success,
    false,
  );
});

test("вход целиком помещается на выбранной стене, прилегание к углу допустимо", () => {
  const schema = entranceSchemaFor(room);
  const north = schema.parse({
    name: "Вход",
    spaceId: null,
    wall: "north",
    offset: 10.7,
    width: 1.5,
  });
  assert.equal(toEntrance(north).wall, "north");
  assert.equal(schema.safeParse({ ...north, offset: 10.8 }).success, false);
  assert.equal(
    schema.safeParse({ ...north, wall: "east", offset: 7.8, width: 0.5 })
      .success,
    true,
  );
  assert.equal(
    schema.safeParse({ ...north, wall: "east", offset: 8, width: 0.5 }).success,
    false,
  );
  assert.equal(schema.safeParse({ ...north, width: 0.4 }).success, false);
});

test("стартовая позиция входа обходит существующие проёмы и не учитывает корзину", () => {
  const entrances = [
    {
      id: "entrance",
      name: "Вход",
      spaceId: null,
      wall: "north" as const,
      offset: 0,
      width: 1.5,
      archived: false,
      archivedAt: null,
    },
  ];
  assert.deepEqual(suggestEntrancePosition(room, entrances, 1.5), {
    wall: "north",
    offset: 1.5,
  });
  entrances[0]!.archived = true;
  assert.deepEqual(suggestEntrancePosition(room, entrances, 1.5), {
    wall: "north",
    offset: 0,
  });
  assert.equal(
    suggestEntrancePosition({ ...room, width: 1, depth: 1 }, [], 1.5),
    null,
  );
  assert.equal(
    entranceSchemaFor({ ...room, width: 1.2 }).safeParse({
      name: "Вход",
      spaceId: null,
      wall: "north",
      offset: 0.1,
      width: 1.1,
    }).success,
    true,
  );
});

function spacesPlan(): WarehousePlanDto {
  return {
    name: "План",
    width: 30,
    depth: 20,
    workZones: [],
    zoneWork: [],
    layoutMode: "spaces",
    spaces: [
      {
        id: "left",
        name: "Левое помещение",
        kind: "room",
        x: 1,
        y: 2,
        width: 4,
        depth: 3,
        archived: false,
        archivedAt: null,
      },
      {
        id: "right",
        name: "Правый коридор",
        kind: "corridor",
        x: 5,
        y: 2,
        width: 4,
        depth: 3,
        archived: false,
        archivedAt: null,
      },
    ],
  };
}
test("вход проверяется по локальной стене выбранного активного участка, не по canvas", () => {
  const warehouse = spacesPlan();
  const values = {
    name: "Вход",
    spaceId: "left",
    wall: "north" as const,
    offset: 3,
    width: 1,
  };
  assert.equal(entranceSchemaFor(warehouse).safeParse(values).success, true);
  assert.equal(
    entranceSchemaFor(warehouse).safeParse({ ...values, offset: 5 }).success,
    false,
  );
  assert.equal(
    entranceSchemaFor(warehouse).safeParse({ ...values, spaceId: null })
      .success,
    false,
  );
  assert.equal(entranceSchemaFor(room).safeParse(values).success, false);
  assert.equal(
    entranceSchemaFor(room).safeParse({ ...values, spaceId: null }).success,
    true,
  );
  warehouse.spaces[0]!.archived = true;
  assert.equal(entranceFrame(warehouse, "left"), null);
  assert.equal(entranceSchemaFor(warehouse).safeParse(values).success, false);
  assert.equal(newEntranceDefaults(warehouse, []).spaceId, "right");
});

test("один физический проём на общей стене нельзя дублировать через соседний участок", () => {
  const warehouse = spacesPlan();
  const rightDoor: EntranceDto = {
    id: "door",
    name: "Проём",
    spaceId: "right",
    wall: "west",
    offset: 0.5,
    width: 1,
    archived: false,
    archivedAt: null,
  };
  const leftDoor = {
    name: "Дубликат",
    spaceId: "left",
    wall: "east" as const,
    offset: 0.5,
    width: 1,
  };
  assert.equal(
    entranceSchemaFor(warehouse, [rightDoor]).safeParse(leftDoor).success,
    false,
  );
  assert.equal(
    entranceSchemaFor(warehouse, [rightDoor], "door").safeParse(leftDoor)
      .success,
    true,
  );
  const suggested = suggestEntrancePosition(warehouse, [rightDoor], 1, "left");
  assert.ok(suggested);
  assert.equal(
    entranceSchemaFor(warehouse, [rightDoor]).safeParse({
      ...leftDoor,
      ...suggested,
    }).success,
    true,
  );
});
