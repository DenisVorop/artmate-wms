import type { PointerGesture } from "./pointer-gesture";
import type { Point } from "./plan-geometry";

export type MapPanKind = "hand" | "background";
export type MapClickOutcome = "clear" | "suppress" | "none";
export type PanStartContext = {
  background?: boolean;
  drawing?: boolean;
  disabled?: boolean;
};
export function panKindForPress(
  context: PanStartContext & {
    handMode: boolean;
    canNavigate: boolean;
    primary: boolean;
  },
): MapPanKind | null {
  if (!context.primary || !context.canNavigate || context.disabled) return null;
  if (context.handMode) return "hand";
  return context.background && !context.drawing ? "background" : null;
}
export function clickAfterMapPress(
  kind: MapPanKind,
  gesture: PointerGesture,
  cancelled: boolean,
): MapClickOutcome {
  return cancelled || kind === "hand" || gesture.dragging
    ? "suppress"
    : "clear";
}
export function scrollAfterMapPan(
  scroll: { left: number; top: number },
  start: Point,
  current: Point,
) {
  return {
    left: scroll.left - (current.x - start.x),
    top: scroll.top - (current.y - start.y),
  };
}
/** Pointer targets can be SVG descendants or text nodes; do not assume HTMLElement. */
export function isMapObjectTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const node = target as { closest?: unknown; parentElement?: unknown };
  if (typeof node.closest === "function")
    return !!node.closest("[data-map-object]");
  return node.parentElement ? isMapObjectTarget(node.parentElement) : false;
}
