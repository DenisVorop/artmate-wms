"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  beginPointerGesture,
  updatePointerGesture,
  type PointerGesture,
} from "./pointer-gesture";
import {
  rectangleFromPoints,
  hasDrawableSize,
  type PlanBounds,
  type Point,
  type SpaceDraft,
} from "./plan-geometry";

type Drawing = {
  pointerId: number;
  start: Point;
  gesture: PointerGesture;
  target: SVGSVGElement;
  kind: SpaceDraft["kind"];
};
type Options = {
  bounds: PlanBounds;
  kind: SpaceDraft["kind"] | null;
  disabled: boolean;
  onDraw?: (rectangle: SpaceDraft) => void;
};
function point(event: ReactPointerEvent<SVGSVGElement>): Point | null {
  const matrix = event.currentTarget.getScreenCTM();
  if (!matrix) return null;
  const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(
    matrix.inverse(),
  );
  return { x: position.x, y: position.y };
}

export function useSpaceDrawing({ bounds, kind, disabled, onDraw }: Options) {
  const current = useRef<Drawing | null>(null);
  const [draft, setDraft] = useState<SpaceDraft | null>(null);
  const cancel = useCallback(() => {
    const drawing = current.current;
    current.current = null;
    if (drawing?.target.hasPointerCapture(drawing.pointerId))
      drawing.target.releasePointerCapture(drawing.pointerId);
    setDraft(null);
  }, []);
  useEffect(() => {
    cancel();
  }, [kind, disabled, cancel]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && current.current) {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [cancel]);

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (!kind || disabled || current.current || event.button !== 0) return;
    const target = event.target as SVGElement;
    if (target.dataset.drawSurface !== "true") return;
    const start = point(event);
    if (!start) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    current.current = {
      pointerId: event.pointerId,
      start,
      target: event.currentTarget,
      kind,
      gesture: beginPointerGesture({ x: event.clientX, y: event.clientY }),
    };
  }
  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const drawing = current.current;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    drawing.gesture = updatePointerGesture(drawing.gesture, "move", {
      x: event.clientX,
      y: event.clientY,
    });
    if (!drawing.gesture.dragging) return;
    const end = point(event);
    if (end)
      setDraft({
        kind: drawing.kind,
        ...rectangleFromPoints(drawing.start, end, bounds),
      });
  }
  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const drawing = current.current;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    // Calculate before onDraw changes page layout or opens a dialog.
    const end = drawing.gesture.dragging ? point(event) : null;
    const rectangle = end
      ? {
          kind: drawing.kind,
          ...rectangleFromPoints(drawing.start, end, bounds),
        }
      : null;
    cancel();
    if (!disabled && rectangle && hasDrawableSize(rectangle))
      onDraw?.(rectangle);
  }
  return {
    draft,
    cancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: cancel,
  };
}
