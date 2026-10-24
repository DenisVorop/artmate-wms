import {
  rotatedFootprint,
  type PlanBounds,
  type PlanRectangle,
  type Point,
} from "./plan-geometry";

/** Snap movement relative to the original position; existing precise coordinates are not a grid error. */
export function positionAfterDrag(
  object: PlanRectangle,
  delta: Point,
  bounds: PlanBounds,
): Point {
  const footprint = rotatedFootprint(object);
  const axis = (origin: number, movement: number, maximum: number) => {
    const snappedDelta =
      (Math.sign(movement) * Math.round(Math.abs(movement) * 10)) / 10;
    // Preserve untouched coordinates exactly; normalize addition noise only on a moved axis.
    const next =
      snappedDelta === 0 ? origin : Number((origin + snappedDelta).toFixed(10));
    return Math.max(0, Math.min(Math.max(0, maximum), next));
  };
  return {
    x: axis(object.x, delta.x, bounds.width - footprint.width),
    y: axis(object.y, delta.y, bounds.depth - footprint.depth),
  };
}
