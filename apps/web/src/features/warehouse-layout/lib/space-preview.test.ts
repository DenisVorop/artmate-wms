import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  EntranceDto,
  WarehousePlanDto,
} from "@/shared/api/generated/model";
import { entranceCenter, planWallLines } from "./plan-geometry";
import { positionAfterDrag } from "./drag-position";
import { warehouseWithSpacePreview } from "./space-preview";
import { beginPointerGesture, updatePointerGesture } from "./pointer-gesture";

const warehouse: WarehousePlanDto = {
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
      id: "corridor",
      name: "Коридор",
      kind: "corridor",
      x: 12,
      y: 3,
      width: 2,
      depth: 5,
      archived: false,
      archivedAt: null,
    },
  ],
};
const entrance: EntranceDto = {
  id: "door",
  name: "Вход",
  spaceId: "room",
  wall: "north",
  offset: 1,
  width: 2,
  archived: false,
  archivedAt: null,
};

test("Preview пола сдвигает помещение, стены и привязанный вход одним смещением, не изменяет соседний участок или исходный snapshot", () => {
  const before = structuredClone(warehouse);
  const next = warehouseWithSpacePreview(warehouse, {
    id: "space:room",
    x: 4.1,
    y: 5.3,
  });
  assert.deepEqual(next.spaces[0], { ...warehouse.spaces[0], x: 4.1, y: 5.3 });
  assert.equal(next.spaces[1], warehouse.spaces[1]);
  assert.deepEqual(warehouse, before);
  assert.deepEqual(entranceCenter(entrance, next), { x: 6.1, y: 5.3 });
  assert.deepEqual(entranceCenter(entrance, warehouse), { x: 4, y: 3 });
  assert.ok(
    planWallLines(next, [entrance]).some(
      (line) =>
        line.y1 === 5.3 &&
        line.y2 === 5.3 &&
        line.x1 === 4.1 &&
        line.x2 === 5.1,
    ),
  );
  assert.ok(
    planWallLines(next, [entrance]).every(
      (line) => !(line.y1 === 3 && line.y2 === 3 && line.x1 < 8),
    ),
  );
});

test("Коридор использует тот же preview; неизвестный, архивный и обычный объект не смещают план", () => {
  const next = warehouseWithSpacePreview(warehouse, {
    id: "space:corridor",
    x: 14,
    y: 2,
  });
  assert.deepEqual(next.spaces[1], { ...warehouse.spaces[1], x: 14, y: 2 });
  assert.equal(warehouseWithSpacePreview(warehouse, null), warehouse);
  assert.equal(
    warehouseWithSpacePreview(warehouse, { id: "section:room", x: 4, y: 5 }),
    warehouse,
  );
  assert.equal(
    warehouseWithSpacePreview(warehouse, { id: "space:missing", x: 4, y: 5 }),
    warehouse,
  );
  const archived = {
    ...warehouse,
    spaces: [{ ...warehouse.spaces[0], archived: true }],
  };
  assert.equal(
    warehouseWithSpacePreview(archived, { id: "space:room", x: 4, y: 5 }),
    archived,
  );
});

test("Участок без вращения движется с шагом 10 см внутри поля; клик и дрожание до 5 px не становятся drag", () => {
  const space = { ...warehouse.spaces[0], rotation: 0 };
  assert.deepEqual(positionAfterDrag(space, { x: 1.26, y: 1.34 }, warehouse), {
    x: 3.3,
    y: 4.3,
  });
  assert.deepEqual(positionAfterDrag(space, { x: -20, y: 200 }, warehouse), {
    x: 0,
    y: 12,
  });
  const press = beginPointerGesture({ x: 100, y: 100 });
  const jitter = updatePointerGesture(press, "move", { x: 103, y: 102 });
  assert.equal(jitter.dragging, false);
  assert.equal(
    updatePointerGesture(jitter, "up", { x: 250, y: 250 }).dragging,
    false,
  );
  assert.equal(
    updatePointerGesture(press, "move", { x: 103, y: 104 }).dragging,
    true,
  );
});
