"use client";
import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { RackSectionDto } from "@/shared/api/generated/model";
import type { PlanBounds, Point } from "./plan-geometry";
import {
  beginPointerGesture,
  updatePointerGesture,
  type PointerGesture,
} from "./pointer-gesture";
import {
  sectionCopyPosition,
  shouldPlaceSectionCopy,
} from "./section-copy-geometry";

type Options = {
  section?: RackSectionDto;
  bounds: PlanBounds;
  pending: boolean;
  panMode: boolean;
  enabled: boolean;
  onPositionChange?: (position: Point) => void;
  onPlace?: (position: Point) => Promise<unknown>;
  onCancel?: () => void;
};
type Press = {
  pointerId: number;
  target: SVGGElement;
  gesture: PointerGesture;
  inverse: DOMMatrix;
  sourceId: string;
};
export function useSectionCopyPlacement(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const current = useRef<Press | null>(null),
    placing = useRef(false);
  const cancelPress = useCallback(() => {
    const press = current.current;
    if (!press) return;
    current.current = null;
    if (press.target.hasPointerCapture(press.pointerId))
      press.target.releasePointerCapture(press.pointerId);
  }, []);
  useEffect(() => {
    cancelPress();
  }, [
    options.section?.id,
    options.enabled,
    options.pending,
    options.panMode,
    cancelPress,
  ]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = latest.current;
      if (
        event.key !== "Escape" ||
        !state.enabled ||
        !state.section ||
        state.pending ||
        placing.current
      )
        return;
      const sourceId = state.section.id;
      // Existing pan/drag Escape listeners get first refusal, regardless of React effect mounting order.
      queueMicrotask(() => {
        const now = latest.current;
        if (
          event.defaultPrevented ||
          !now.enabled ||
          now.pending ||
          placing.current ||
          now.section?.id !== sourceId
        )
          return;
        cancelPress();
        now.onCancel?.();
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelPress]);
  function position(
    event: ReactPointerEvent<SVGGElement>,
    inverse?: DOMMatrix,
  ): Point | null {
    const state = latest.current;
    const matrix =
      inverse ?? event.currentTarget.ownerSVGElement?.getScreenCTM()?.inverse();
    if (!matrix || !state.section) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix,
    );
    return sectionCopyPosition(
      { x: point.x, y: point.y },
      state.section,
      state.bounds,
    );
  }
  const canPlace = () => {
    const state = latest.current;
    return (
      state.enabled &&
      !!state.section &&
      !state.pending &&
      !state.panMode &&
      !placing.current
    );
  };
  function onPointerMove(event: ReactPointerEvent<SVGGElement>) {
    event.stopPropagation();
    const press = current.current;
    if (press && press.pointerId !== event.pointerId) return;
    if (press)
      press.gesture = updatePointerGesture(press.gesture, "move", {
        x: event.clientX,
        y: event.clientY,
      });
    if (!canPlace()) return;
    const next = position(event, press?.inverse);
    if (next) latest.current.onPositionChange?.(next);
  }
  function onPointerDown(event: ReactPointerEvent<SVGGElement>) {
    event.stopPropagation();
    if (event.button !== 0 || !canPlace() || current.current) return;
    const inverse = event.currentTarget.ownerSVGElement
      ?.getScreenCTM()
      ?.inverse();
    if (!inverse) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    current.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      inverse,
      sourceId: latest.current.section!.id,
      gesture: beginPointerGesture({ x: event.clientX, y: event.clientY }),
    };
    const next = position(event, inverse);
    if (next) latest.current.onPositionChange?.(next);
  }
  async function onPointerUp(event: ReactPointerEvent<SVGGElement>) {
    event.stopPropagation();
    const press = current.current;
    if (!press || press.pointerId !== event.pointerId) return;
    const next = position(event, press.inverse),
      state = latest.current;
    const allowed =
      canPlace() &&
      state.section?.id === press.sourceId &&
      shouldPlaceSectionCopy(press.gesture, state.pending, false);
    cancelPress();
    if (!allowed || !next || !state.onPlace) return;
    state.onPositionChange?.(next);
    placing.current = true;
    try {
      await state.onPlace(next);
    } catch {
      /* Parent preserves the mode, position and API error. */
    } finally {
      placing.current = false;
    }
  }
  return {
    cancelPress,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: cancelPress,
    onLostPointerCapture: (event: ReactPointerEvent<SVGGElement>) => {
      if (current.current?.pointerId === event.pointerId) cancelPress();
    },
  };
}
