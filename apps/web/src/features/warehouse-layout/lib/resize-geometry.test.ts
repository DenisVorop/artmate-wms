import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resizeSpaceGeometry,
  resizePointerDelta,
  sameResizeGeometry,
  resizeHandlePoint,
  type ResizeDirection,
} from "./resize-geometry";
import { workspaceWithResizePreview } from "./resize-preview";
import type { WarehousePlanDto } from "@/shared/api/generated/model";

const original = { x: 2.37, y: 7.52, width: 4.8, depth: 3.2 },
  bounds = { width: 24, depth: 20 };
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
test("Восемь ручек меняют только свои стороны и сохраняют противоположные границы", () => {
  const expected: Record<ResizeDirection, typeof original> = {
    nw: { x: 2.57, y: 7.82, width: 4.6, depth: 2.9 },
    n: { x: 2.37, y: 7.82, width: 4.8, depth: 2.9 },
    ne: { x: 2.37, y: 7.82, width: 5, depth: 2.9 },
    e: { x: 2.37, y: 7.52, width: 5, depth: 3.2 },
    se: { x: 2.37, y: 7.52, width: 5, depth: 3.5 },
    s: { x: 2.37, y: 7.52, width: 4.8, depth: 3.5 },
    sw: { x: 2.57, y: 7.52, width: 4.6, depth: 3.5 },
    w: { x: 2.57, y: 7.52, width: 4.6, depth: 3.2 },
  };
  for (const direction of Object.keys(expected) as ResizeDirection[]) {
    const next = resizeSpaceGeometry(
      original,
      direction,
      { x: 0.21, y: 0.29 },
      bounds,
    );
    assert.deepEqual(next, expected[direction]);
    if (direction.includes("w"))
      close(next.x + next.width, original.x + original.width);
    if (direction.includes("n"))
      close(next.y + next.depth, original.y + original.depth);
  }
  assert.deepEqual(original, { x: 2.37, y: 7.52, width: 4.8, depth: 3.2 });
});
test("Минимум .5м, границы поля и максимум1000 не допускают переворота ручек", () => {
  const minimum = resizeSpaceGeometry(
    original,
    "nw",
    { x: 100, y: 100 },
    bounds,
  );
  assert.equal(minimum.width, 0.5);
  assert.equal(minimum.depth, 0.5);
  close(minimum.x + minimum.width, original.x + original.width);
  close(minimum.y + minimum.depth, original.y + original.depth);
  const topLeft = resizeSpaceGeometry(
    original,
    "nw",
    { x: -100, y: -100 },
    bounds,
  );
  assert.equal(topLeft.x, 0);
  assert.equal(topLeft.y, 0);
  const bottomRight = resizeSpaceGeometry(
    original,
    "se",
    { x: 100, y: 100 },
    bounds,
  );
  close(bottomRight.x + bottomRight.width, bounds.width);
  close(bottomRight.y + bottomRight.depth, bounds.depth);
  assert.deepEqual(
    resizeSpaceGeometry(
      { x: 0, y: 0, width: 10, depth: 10 },
      "se",
      { x: 2000, y: 2000 },
      { width: 2000, depth: 2000 },
    ),
    { x: 0, y: 0, width: 1000, depth: 1000 },
  );
});
test("Нулевая или меньшая половины шага дельта остаётся no-op, нетронутая ось сохраняется точно", () => {
  const precise = { ...original, y: 7.52345678901, depth: 3.23456789012 };
  const unchanged = resizeSpaceGeometry(
    precise,
    "ne",
    { x: 0.049, y: -0.049 },
    bounds,
  );
  assert.equal(sameResizeGeometry(precise, unchanged), true);
  const east = resizeSpaceGeometry(precise, "e", { x: 1.02, y: 5 }, bounds);
  assert.equal(east.y, precise.y);
  assert.equal(east.depth, precise.depth);
  assert.equal(east.x, precise.x);
  assert.equal(east.width, 5.8);
  assert.deepEqual(resizeHandlePoint(original, "nw"), {
    x: original.x,
    y: original.y,
  });
  assert.deepEqual(resizeHandlePoint(original, "e"), {
    x: original.x + original.width,
    y: original.y + original.depth / 2,
  });
});
test("Замороженная обратная SVG-матрица переводит клиентскую дельту без зависимости от последующего fit/scroll", () => {
  const captured = { a: 0.02, b: 0, c: 0, d: 0.02 };
  assert.deepEqual(
    resizePointerDelta({ x: 100, y: 200 }, { x: 150, y: 190 }, captured),
    { x: 1, y: -0.2 },
  );
  const later = { a: 0.01, b: 0, c: 0, d: 0.01 };
  assert.notDeepEqual(
    resizePointerDelta({ x: 100, y: 200 }, { x: 150, y: 190 }, later),
    resizePointerDelta({ x: 100, y: 200 }, { x: 150, y: 190 }, captured),
  );
});
test("NW resize preview меняет только границы; оборудование и складской snapshot не сдвигаются", () => {
  const warehouse: WarehousePlanDto = {
    name: "Склад",
    width: 24,
    depth: 20,
    layoutMode: "spaces",
    spaces: [
      {
        ...original,
        id: "room",
        name: "Помещение",
        kind: "room",
        archived: false,
        archivedAt: null,
      },
    ],
  };
  const scene = {
    warehouse,
    sections: [{ id: "rack", x: 3, y: 8 }],
    locations: [{ id: "address", x: 3, y: 8 }],
    aisles: [{ id: "aisle", x: 4, y: 8 }],
    pallets: [{ id: "pallet", locationId: "address" }],
  };
  const before = structuredClone(scene);
  const geometry = resizeSpaceGeometry(
    original,
    "nw",
    { x: -0.4, y: -0.2 },
    bounds,
  );
  const preview = workspaceWithResizePreview(scene, {
    ...geometry,
    id: "room",
  });
  assert.deepEqual(preview.warehouse.spaces[0], {
    ...warehouse.spaces[0],
    ...geometry,
  });
  for (const key of ["sections", "locations", "aisles", "pallets"] as const)
    assert.equal(preview[key], scene[key]);
  assert.deepEqual(scene, before);
  assert.equal(workspaceWithResizePreview(scene, null), scene);
  assert.equal(
    workspaceWithResizePreview(scene, { ...geometry, id: "missing" }),
    scene,
  );
});
