import assert from "node:assert/strict";
import { test } from "node:test";
import type { WarehouseSpaceDto } from "@/shared/api/generated/model";
import {
  entranceCenter,
  findSuggestedPosition,
  hasDrawableSize,
  nearestEntrancePosition,
  planWallLines,
  rectangleFromPoints,
  type PlanBounds,
} from "./plan-geometry";

const space = (values: Partial<WarehouseSpaceDto> = {}): WarehouseSpaceDto => ({
  id: "room-a",
  name: "Помещение",
  kind: "room",
  x: 0,
  y: 0,
  width: 4,
  depth: 4,
  archived: false,
  archivedAt: null,
  ...values,
});
const plan = (
  spaces: WarehouseSpaceDto[],
  width = 24,
  depth = 16,
): PlanBounds => ({ width, depth, layoutMode: "spaces", spaces });

test("Центр входа использует глобальное начало участка и не рисуется при неверной привязке", () => {
  const bounds = plan([space({ x: 10, y: 4, width: 6, depth: 3 })]);
  assert.deepEqual(
    entranceCenter(
      { spaceId: "room-a", wall: "west", offset: 1, width: 1 },
      bounds,
    ),
    { x: 10, y: 5.5 },
  );
  assert.deepEqual(
    entranceCenter(
      { spaceId: "room-a", wall: "south", offset: 2, width: 2 },
      bounds,
    ),
    { x: 13, y: 7 },
  );
  assert.equal(
    entranceCenter(
      { spaceId: null, wall: "south", offset: 2, width: 2 },
      bounds,
    ),
    null,
  );
  assert.deepEqual(
    entranceCenter(
      { spaceId: null, wall: "south", offset: 2, width: 2 },
      { width: 24, depth: 16 },
    ),
    { x: 3, y: 16 },
  );
});

test("Перетаскивание входа выбирает стену участка в глобальных координатах и сохраняет привязку при общей стене", () => {
  const bounds = plan([
    space(),
    space({ id: "room-b", x: 4, width: 3, kind: "corridor" }),
  ]);
  assert.deepEqual(
    nearestEntrancePosition({ x: 7, y: 2 }, 1, bounds, "east", "room-a"),
    { spaceId: "room-b", wall: "east", offset: 1.5 },
  );
  assert.deepEqual(
    nearestEntrancePosition({ x: 4, y: 2 }, 1, bounds, "east", "room-a"),
    { spaceId: "room-a", wall: "east", offset: 1.5 },
  );
  assert.deepEqual(
    nearestEntrancePosition({ x: 4, y: 2 }, 1, bounds, "west", "room-b"),
    { spaceId: "room-b", wall: "west", offset: 1.5 },
  );
  assert.equal(nearestEntrancePosition({ x: 2, y: 2 }, 1, plan([])), null);
});

test("Общая стена рисуется один раз и вход прорезает обе совпадающие границы", () => {
  const bounds = plan([
    space(),
    space({ id: "room-b", x: 4, width: 3, kind: "corridor" }),
  ]);
  const walls = planWallLines(bounds, [
    { spaceId: "room-a", wall: "east", offset: 1, width: 1 },
  ]);
  assert.deepEqual(
    walls.filter((line) => line.x1 === 4 && line.x2 === 4),
    [
      { x1: 4, y1: 0, x2: 4, y2: 1 },
      { x1: 4, y1: 2, x2: 4, y2: 4 },
    ],
  );
  assert.equal(walls.length, 6);
  assert.equal(
    new Set(walls.map((line) => JSON.stringify(line))).size,
    walls.length,
  );
  assert.deepEqual(
    planWallLines(bounds, [
      { spaceId: "room-a", wall: "east", offset: 1, width: 1 },
      { spaceId: "room-b", wall: "west", offset: 1, width: 1 },
    ]),
    walls,
  );
});

test("Частично совпадающая стена нормализуется до вычитания проёма", () => {
  const bounds = plan([
    space(),
    space({ id: "room-b", x: 4, y: 2, width: 2, depth: 2 }),
  ]);
  assert.deepEqual(
    planWallLines(bounds, [
      { spaceId: "room-b", wall: "west", offset: 0.5, width: 0.5 },
    ]).filter((line) => line.x1 === 4 && line.x2 === 4),
    [
      { x1: 4, y1: 0, x2: 4, y2: 2.5 },
      { x1: 4, y1: 3, x2: 4, y2: 4 },
    ],
  );
});

test("Пустой spaces-план не получает фиктивный пол или внешние стены", () => {
  assert.deepEqual(planWallLines(plan([]), []), []);
  assert.deepEqual(planWallLines(plan([space({ archived: true })]), []), []);
  assert.equal(planWallLines({ width: 24, depth: 16 }, []).length, 4);
  assert.equal(findSuggestedPosition(plan([]), []), null);
});

test("Подсказка размещения ищет внутри одного активного участка, включая коридоры и удалённые помещения", () => {
  const bounds = plan([
    space({ width: 2, depth: 2 }),
    space({ id: "corridor", kind: "corridor", x: 8, width: 4, depth: 2 }),
  ]);
  assert.deepEqual(
    findSuggestedPosition(bounds, [], { width: 3, depth: 1.5, rotation: 0 }),
    { x: 8, y: 0 },
  );
  assert.equal(
    findSuggestedPosition(
      plan([
        space({ width: 1.5, depth: 2 }),
        space({ id: "room-b", x: 1.5, width: 1.5, depth: 2 }),
      ]),
      [],
      { width: 3, depth: 1.5, rotation: 0 },
    ),
    null,
  );
  assert.deepEqual(
    findSuggestedPosition(
      plan([space({ x: 900, y: 900, width: 4, depth: 2 })], 1000, 1000),
      [],
    ),
    { x: 900, y: 900 },
  );
});

test("Рисунок привязывается к сетке, нормализует обратный drag и допускает только площадь с обоими размерами от 0,5 м", () => {
  assert.deepEqual(
    rectangleFromPoints(
      { x: 9.8, y: 8.1 },
      { x: 2.2, y: 4.2 },
      { width: 10, depth: 10 },
    ),
    { x: 2, y: 4, width: 8, depth: 4 },
  );
  assert.deepEqual(
    rectangleFromPoints(
      { x: -2, y: 4 },
      { x: 12, y: 12 },
      { width: 10, depth: 10 },
    ),
    { x: 0, y: 4, width: 10, depth: 6 },
  );
  assert.equal(hasDrawableSize({ width: 0, depth: 4 }), false);
  assert.equal(hasDrawableSize({ width: 0.5, depth: 0.5 }), true);
});
