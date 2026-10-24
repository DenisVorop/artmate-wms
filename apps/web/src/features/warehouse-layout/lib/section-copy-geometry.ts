import type { RackSectionDto } from "@/shared/api/generated/model";
import type { PointerGesture } from "./pointer-gesture";
import {
  rotatedFootprint,
  snapAndClampPosition,
  type PlanBounds,
  type Point,
} from "./plan-geometry";

/** New sections use the absolute 10 cm placement grid, centered by their rotated outer footprint. */
export function sectionCopyPosition(
  center: Point,
  section: Pick<RackSectionDto, "width" | "depth" | "rotation">,
  bounds: PlanBounds,
): Point {
  const size = rotatedFootprint(section);
  const position = snapAndClampPosition(
    { x: center.x - size.width / 2, y: center.y - size.depth / 2 },
    section,
    bounds,
  );
  return {
    x: Number(position.x.toFixed(10)),
    y: Number(position.y.toFixed(10)),
  };
}
export function shouldPlaceSectionCopy(
  gesture: PointerGesture,
  pending: boolean,
  cancelled: boolean,
): boolean {
  return !gesture.dragging && !pending && !cancelled;
}
