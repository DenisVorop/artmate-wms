import type { WarehouseSpaceDto } from "@/shared/api/generated/model";
import type { PlanBounds, Point } from "./plan-geometry";

export type ResizeSpaceGeometry = Pick<
  WarehouseSpaceDto,
  "x" | "y" | "width" | "depth"
>;
export const resizeDirections = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
] as const;
export type ResizeDirection = (typeof resizeDirections)[number];
export type InverseLinearMatrix = {
  a: number;
  b: number;
  c: number;
  d: number;
};
const clean = (value: number) => Number(value.toFixed(10));
const snap = (value: number) =>
  (Math.sign(value) * Math.round(Math.abs(value) * 10)) / 10;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** Uses coefficients captured on pointerdown; a later DOM/viewBox change cannot speed up the gesture. */
export function resizePointerDelta(
  start: Point,
  end: Point,
  inverse: InverseLinearMatrix,
): Point {
  const x = end.x - start.x,
    y = end.y - start.y;
  return { x: inverse.a * x + inverse.c * y, y: inverse.b * x + inverse.d * y };
}
export function resizeSpaceGeometry(
  original: ResizeSpaceGeometry,
  direction: ResizeDirection,
  delta: Point,
  bounds: PlanBounds,
): ResizeSpaceGeometry {
  const dx = snap(delta.x),
    dy = snap(delta.y);
  let x = original.x,
    y = original.y,
    width = original.width,
    depth = original.depth;
  if (direction.includes("w") && dx !== 0) {
    const right = original.x + original.width;
    x = clamp(clean(original.x + dx), Math.max(0, right - 1000), right - 0.5);
    if (x !== original.x) width = clean(right - x);
  } else if (direction.includes("e") && dx !== 0) {
    width = clamp(
      clean(original.width + dx),
      0.5,
      Math.min(1000, bounds.width - original.x),
    );
  }
  if (direction.includes("n") && dy !== 0) {
    const bottom = original.y + original.depth;
    y = clamp(clean(original.y + dy), Math.max(0, bottom - 1000), bottom - 0.5);
    if (y !== original.y) depth = clean(bottom - y);
  } else if (direction.includes("s") && dy !== 0) {
    depth = clamp(
      clean(original.depth + dy),
      0.5,
      Math.min(1000, bounds.depth - original.y),
    );
  }
  return { x, y, width, depth };
}
export function sameResizeGeometry(
  a: ResizeSpaceGeometry,
  b: ResizeSpaceGeometry,
): boolean {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.depth === b.depth
  );
}
export function resizeHandlePoint(
  geometry: ResizeSpaceGeometry,
  direction: ResizeDirection,
): Point {
  return {
    x:
      geometry.x +
      (direction.includes("w")
        ? 0
        : direction.includes("e")
          ? geometry.width
          : geometry.width / 2),
    y:
      geometry.y +
      (direction.includes("n")
        ? 0
        : direction.includes("s")
          ? geometry.depth
          : geometry.depth / 2),
  };
}
