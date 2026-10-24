import assert from "node:assert/strict";
import { test } from "node:test";
import { growWorkingField } from "./field-resize";
test("Расширение снизу/справа меняет только нужный размер поля и сохраняет точную другую ось", () => {
  const field = { width: 30.27, depth: 20.13 };
  assert.deepEqual(growWorkingField(field, "bottom"), {
    width: 30.27,
    depth: 30.13,
  });
  assert.deepEqual(growWorkingField(field, "right"), {
    width: 40.27,
    depth: 20.13,
  });
  assert.deepEqual(field, { width: 30.27, depth: 20.13 });
  assert.deepEqual(
    growWorkingField({ width: 1.00000000000001, depth: 20.13 }, "right"),
    { width: 11.00000000000001, depth: 20.13 },
  );
});
test("Последнее расширение ограничено 1000 м и не меняет достигнутый предел", () => {
  assert.deepEqual(growWorkingField({ width: 997.3, depth: 1 }, "right"), {
    width: 1000,
    depth: 1,
  });
  assert.deepEqual(growWorkingField({ width: 1, depth: 999.9 }, "bottom"), {
    width: 1,
    depth: 1000,
  });
  assert.deepEqual(growWorkingField({ width: 1000, depth: 1000 }, "bottom"), {
    width: 1000,
    depth: 1000,
  });
});
