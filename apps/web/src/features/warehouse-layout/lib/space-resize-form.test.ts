import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  WarehousePlanDto,
  WarehouseSpaceDto,
} from "@/shared/api/generated/model";
import {
  spaceResizeDefaults,
  spaceResizeSchema,
  spaceResizeSchemaFor,
} from "./space-resize-form";
const space: WarehouseSpaceDto = {
  id: "room",
  name: "Склад",
  kind: "room",
  x: 1.37,
  y: 2.26,
  width: 8.04,
  depth: 6.13,
  archived: false,
  archivedAt: null,
};
const warehouse: WarehousePlanDto = {
  name: "План",
  width: 30.2,
  depth: 20,
  layoutMode: "spaces",
  spaces: [space],
};
test("Точная форма сохраняет исходные дробные границы без snap и не включает команду группового переноса", () => {
  const values = spaceResizeDefaults(space);
  assert.deepEqual(values, { x: 1.37, y: 2.26, width: 8.04, depth: 6.13 });
  assert.deepEqual(
    spaceResizeSchemaFor(warehouse, space.id).parse(values),
    values,
  );
  assert.deepEqual(Object.keys(values).sort(), ["depth", "width", "x", "y"]);
  assert.equal("name" in values, false);
  assert.equal("kind" in values, false);
});
test("Размер участка 0,5..1000 м, координаты неотрицательные, дробные значения допустимы", () => {
  const values = spaceResizeDefaults(space);
  for (const width of [0, 0.49, 1000.1, Number.NaN, Infinity])
    assert.equal(
      spaceResizeSchema.safeParse({ ...values, width }).success,
      false,
    );
  for (const width of [0.5, 0.83, 1000])
    assert.equal(
      spaceResizeSchema.safeParse({ ...values, width }).success,
      true,
    );
  assert.equal(
    spaceResizeSchema.safeParse({ ...values, x: -0.01 }).success,
    false,
  );
  assert.equal(
    spaceResizeSchema.safeParse({ ...values, y: Infinity }).success,
    false,
  );
});
test("При изменении левой/верхней границы форма отправляет точную геометрию и оставляет исходный объект неизменным", () => {
  const values = spaceResizeSchemaFor(warehouse, space.id).parse({
    ...spaceResizeDefaults(space),
    x: 0.5,
    y: 1.1,
    width: 10,
    depth: 8,
  });
  assert.deepEqual(values, { x: 0.5, y: 1.1, width: 10, depth: 8 });
  assert.equal(space.x, 1.37);
  assert.equal(space.y, 2.26);
});
test("Рабочее поле и другие активные участки ограничивают границы; касание и архив допустимы", () => {
  const values = spaceResizeDefaults(space);
  assert.equal(
    spaceResizeSchemaFor(warehouse, space.id).safeParse({
      ...values,
      width: 30,
    }).success,
    false,
  );
  assert.equal(
    spaceResizeSchemaFor(warehouse, space.id).safeParse({
      ...values,
      depth: 20,
    }).success,
    false,
  );
  const adjacent = {
    ...space,
    id: "adjacent",
    name: "Соседний",
    x: 15,
    y: 2,
    width: 5,
    depth: 6,
  };
  const schema = spaceResizeSchemaFor(
    { ...warehouse, spaces: [space, adjacent] },
    space.id,
  );
  assert.equal(schema.safeParse({ ...values, x: 1, width: 14 }).success, true);
  assert.equal(
    schema.safeParse({ ...values, x: 1, width: 14.01 }).success,
    false,
  );
  assert.equal(
    spaceResizeSchemaFor(
      { ...warehouse, spaces: [space, { ...adjacent, archived: true }] },
      space.id,
    ).safeParse({ ...values, x: 1, width: 14.01 }).success,
    true,
  );
});
