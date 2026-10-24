import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sectionCopyPosition,
  shouldPlaceSectionCopy,
} from "./section-copy-geometry";
import { beginPointerGesture, updatePointerGesture } from "./pointer-gesture";
import { sectionCopyPlacementSchema } from "./section-copy-form";

test("Копия центрируется под указателем по настоящему rotated footprint, позиция привязана к 10 см", () => {
  const bounds = { width: 24, depth: 16 },
    center = { x: 10, y: 7 };
  const source = { width: 3, depth: 1.5, rotation: 0 as const };
  assert.deepEqual(sectionCopyPosition(center, source, bounds), {
    x: 8.5,
    y: 6.3,
  });
  assert.deepEqual(
    sectionCopyPosition(center, { ...source, rotation: 180 }, bounds),
    { x: 8.5, y: 6.3 },
  );
  assert.deepEqual(
    sectionCopyPosition(center, { ...source, rotation: 90 }, bounds),
    { x: 9.3, y: 5.5 },
  );
  assert.deepEqual(
    sectionCopyPosition(center, { ...source, rotation: 270 }, bounds),
    { x: 9.3, y: 5.5 },
  );
  assert.deepEqual(source, { width: 3, depth: 1.5, rotation: 0 });
});
test("Копия ограничена рабочим полем с учётом поворота и точного дробного края", () => {
  const source = { width: 3.2, depth: 1.1, rotation: 0 as const },
    bounds = { width: 12.37, depth: 10.52 };
  assert.deepEqual(sectionCopyPosition({ x: -100, y: -100 }, source, bounds), {
    x: 0,
    y: 0,
  });
  assert.deepEqual(sectionCopyPosition({ x: 100, y: 100 }, source, bounds), {
    x: 9.17,
    y: 9.42,
  });
  assert.deepEqual(
    sectionCopyPosition(
      { x: 100, y: 100 },
      { ...source, rotation: 90 },
      bounds,
    ),
    { x: 11.27, y: 7.32 },
  );
});
test("Только короткий primary press создаёт копию: drag 5px, возврат назад, cancel и pending не создают", () => {
  const press = beginPointerGesture({ x: 100, y: 100 });
  const jitter = updatePointerGesture(press, "move", { x: 102, y: 102 });
  assert.equal(shouldPlaceSectionCopy(jitter, false, false), true);
  const drag = updatePointerGesture(press, "move", { x: 103, y: 104 });
  assert.equal(shouldPlaceSectionCopy(drag, false, false), false);
  assert.equal(
    shouldPlaceSectionCopy(
      updatePointerGesture(drag, "move", { x: 100, y: 100 }),
      false,
      false,
    ),
    false,
  );
  assert.equal(shouldPlaceSectionCopy(press, true, false), false);
  assert.equal(shouldPlaceSectionCopy(press, false, true), false);
});
test("Точная форма принимает дробные координаты без принудительного snap, отклоняет пустые/нечисловые/выход за пределы", () => {
  const values = { x: 1.2345, y: 7.52 };
  assert.deepEqual(sectionCopyPlacementSchema.parse(values), values);
  for (const x of [-0.1, 1000.1, NaN, Infinity, "", null])
    assert.equal(
      sectionCopyPlacementSchema.safeParse({ x, y: 0 }).success,
      false,
    );
  assert.equal(
    sectionCopyPlacementSchema.safeParse({ x: 0, y: 1000 }).success,
    true,
  );
});
