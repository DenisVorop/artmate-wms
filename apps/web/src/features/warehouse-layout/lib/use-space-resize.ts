"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { PlanBounds, Point } from "./plan-geometry";
import {
  beginPointerGesture,
  updatePointerGesture,
  type PointerGesture,
} from "./pointer-gesture";
import {
  resizePointerDelta,
  resizeSpaceGeometry,
  sameResizeGeometry,
  type InverseLinearMatrix,
  type ResizeDirection,
  type ResizeSpaceGeometry,
} from "./resize-geometry";

type Drag = {
  id: string;
  original: ResizeSpaceGeometry;
  direction: ResizeDirection;
  bounds: PlanBounds;
  inverse: InverseLinearMatrix;
  pointerId: number;
  start: Point;
  target: SVGGElement;
  gesture: PointerGesture;
};
type Options = {
  bounds: PlanBounds;
  enabled: boolean;
  canStart: () => boolean;
  onResize?: (id: string, geometry: ResizeSpaceGeometry) => Promise<unknown>;
  onSelect: (id: string) => void;
  onSaveState: (state: "saving" | "saved" | "error") => void;
  onBusyChange: (busy: boolean) => void;
};
export function useSpaceResize({
  bounds,
  enabled,
  canStart,
  onResize,
  onSelect,
  onSaveState,
  onBusyChange,
}: Options) {
  const current = useRef<Drag | null>(null),
    busy = useRef(false);
  const [preview, setPreview] = useState<
    (ResizeSpaceGeometry & { id: string }) | null
  >(null);
  const [resizing, setResizing] = useState(false);
  const markBusy = (value: boolean) => {
    busy.current = value;
    setResizing(value);
    onBusyChange(value);
  };
  const cancel = useCallback(() => {
    const drag = current.current;
    if (!drag) return;
    current.current = null;
    busy.current = false;
    setResizing(false);
    onBusyChange(false);
    setPreview(null);
    if (drag.target.hasPointerCapture(drag.pointerId))
      drag.target.releasePointerCapture(drag.pointerId);
  }, [onBusyChange]);
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && current.current) {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel]);
  function onPointerDown(
    event: ReactPointerEvent<SVGGElement>,
    id: string,
    original: ResizeSpaceGeometry,
    direction: ResizeDirection,
    pending: boolean,
  ) {
    event.stopPropagation();
    if (
      !enabled ||
      !onResize ||
      pending ||
      busy.current ||
      !canStart() ||
      event.button !== 0
    )
      return;
    const inverse = event.currentTarget.ownerSVGElement
      ?.getScreenCTM()
      ?.inverse();
    if (!inverse) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    current.current = {
      id,
      original: { ...original },
      direction,
      bounds: { ...bounds },
      inverse: { a: inverse.a, b: inverse.b, c: inverse.c, d: inverse.d },
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      target: event.currentTarget,
      gesture: beginPointerGesture({ x: event.clientX, y: event.clientY }),
    };
    markBusy(true);
  }
  function geometryFor(drag: Drag, event: ReactPointerEvent<SVGGElement>) {
    return resizeSpaceGeometry(
      drag.original,
      drag.direction,
      resizePointerDelta(
        drag.start,
        { x: event.clientX, y: event.clientY },
        drag.inverse,
      ),
      drag.bounds,
    );
  }
  function onPointerMove(event: ReactPointerEvent<SVGGElement>) {
    const drag = current.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (!enabled) {
      cancel();
      return;
    }
    drag.gesture = updatePointerGesture(drag.gesture, "move", {
      x: event.clientX,
      y: event.clientY,
    });
    if (drag.gesture.dragging)
      setPreview({ id: drag.id, ...geometryFor(drag, event) });
  }
  async function onPointerUp(event: ReactPointerEvent<SVGGElement>) {
    const drag = current.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (!enabled) {
      cancel();
      return;
    }
    const next = drag.gesture.dragging ? geometryFor(drag, event) : null;
    current.current = null;
    if (drag.target.hasPointerCapture(drag.pointerId))
      drag.target.releasePointerCapture(drag.pointerId);
    if (!next || sameResizeGeometry(next, drag.original)) {
      markBusy(false);
      setPreview(null);
      return;
    }
    setPreview({ id: drag.id, ...next });
    onSelect(`space:${drag.id}`);
    onSaveState("saving");
    try {
      await onResize!(drag.id, next);
      onSaveState("saved");
    } catch {
      onSaveState("error");
    } finally {
      markBusy(false);
      setPreview(null);
    }
  }
  return {
    preview,
    resizing,
    cancel,
    isBusy: () => busy.current,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: cancel,
    onLostPointerCapture: (event: ReactPointerEvent<SVGGElement>) => {
      if (current.current?.pointerId === event.pointerId) cancel();
    },
  };
}
