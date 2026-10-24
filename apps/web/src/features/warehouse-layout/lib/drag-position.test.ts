import assert from "node:assert/strict";
import { test } from "node:test";
import { positionAfterDrag } from "./drag-position";

const bounds = { width: 24, depth: 16 };
const corridor = { x: 10, y: 7.52, width: 4, depth: 2, rotation: 0 };

test("Горизонтальный drag сохраняет точный Y соседнего помещения, вертикальный сохраняет точный X", () => {
  assert.deepEqual(positionAfterDrag(corridor, { x: -1.03, y: 0 }, bounds), {
    x: 9,
    y: 7.52,
  });
  const precise = { ...corridor, x: 10.37 };
  assert.deepEqual(positionAfterDrag(precise, { x: 0, y: 1.04 }, bounds), {
    x: 10.37,
    y: 8.52,
  });
  assert.deepEqual(positionAfterDrag(precise, { x: 0.1, y: -0.2 }, bounds), {
    x: 10.47,
    y: 7.32,
  });
});

test("Нулевое и меньше половины шага смещение сохраняют исходную дробную позицию как no-op", () => {
  const precise = { ...corridor, x: 10.37123456789 };
  assert.deepEqual(positionAfterDrag(precise, { x: 0, y: 0 }, bounds), {
    x: precise.x,
    y: precise.y,
  });
  assert.deepEqual(
    positionAfterDrag(precise, { x: 0.049, y: -0.049 }, bounds),
    { x: precise.x, y: precise.y },
  );
  assert.deepEqual(
    positionAfterDrag(corridor, { x: -0.051, y: 0.051 }, bounds),
    { x: 9.9, y: 7.62 },
  );
});

test("Ограничение поля учитывает footprint и поворот, даже если край находится вне сетки шага", () => {
  const preciseBounds = { width: 16.52, depth: 12.37 };
  assert.deepEqual(
    positionAfterDrag(corridor, { x: 100, y: 100 }, preciseBounds),
    { x: 12.52, y: 10.37 },
  );
  assert.deepEqual(
    positionAfterDrag(
      { ...corridor, rotation: 90 },
      { x: 100, y: 100 },
      preciseBounds,
    ),
    { x: 14.52, y: 8.37 },
  );
  assert.deepEqual(
    positionAfterDrag(
      { ...corridor, rotation: 270 },
      { x: -100, y: -100 },
      bounds,
    ),
    { x: 0, y: 0 },
  );
  assert.deepEqual(
    positionAfterDrag(
      { ...corridor, rotation: 180 },
      { x: 100, y: 100 },
      bounds,
    ),
    { x: 20, y: 14 },
  );
});
