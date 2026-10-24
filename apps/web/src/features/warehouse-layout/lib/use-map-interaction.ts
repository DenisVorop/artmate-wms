"use client";
import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import type { EntranceDto } from "@/shared/api/generated/model";
import {
  entranceCenter,
  nearestEntrancePosition,
  type EntrancePosition,
  type PlanBounds,
  type PlanRectangle,
  type Point,
} from "./plan-geometry";
import {
  beginPointerGesture,
  updatePointerGesture,
  type PointerGesture,
} from "./pointer-gesture";
import { usePlanViewport } from "./use-plan-viewport";
import { useSpaceResize } from "./use-space-resize";
import type { ResizeSpaceGeometry } from "./resize-geometry";
import { positionAfterDrag } from "./drag-position";

type DraggableObject = PlanRectangle & { id: string };
type DragPress = {
  pointerId: number;
  gesture: PointerGesture;
  target: SVGGElement;
};
type ObjectDrag = DragPress & {
  kind: "object";
  object: DraggableObject;
  start: Point;
};
type EntranceDrag = DragPress & {
  kind: "entrance";
  entrance: EntranceDto;
  grabDelta: Point;
};
type Drag = ObjectDrag | EntranceDrag;
type Options = {
  bounds: PlanBounds;
  enabled?: boolean;
  dragEnabled?: boolean;
  onMove: (id: string, position: Point) => Promise<unknown>;
  onResizeSpace?: (
    id: string,
    geometry: ResizeSpaceGeometry,
  ) => Promise<unknown>;
  onMoveEntrance: (id: string, position: EntrancePosition) => Promise<unknown>;
};

function pointerPosition(event: ReactPointerEvent<SVGElement>): Point | null {
  const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
    matrix.inverse(),
  );
  return { x: point.x, y: point.y };
}

export function useMapInteraction({
  bounds,
  onMove,
  onMoveEntrance,
  onResizeSpace,
  enabled = true,
  dragEnabled = true,
}: Options) {
  const drag = useRef<Drag | null>(null);
  const saving = useRef(false);
  const resizeLock = useRef(false);
  const viewport = usePlanViewport(
    bounds,
    enabled,
    () => !drag.current && !saving.current && !resizeLock.current,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditingState] = useState(false);
  const [preview, setPreview] = useState<(Point & { id: string }) | null>(null);
  const [entrancePreview, setEntrancePreview] = useState<
    (EntrancePosition & { id: string }) | null
  >(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const cancelObjectDrag = useCallback(() => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (current?.target.hasPointerCapture(current.pointerId))
      current.target.releasePointerCapture(current.pointerId);
    setPreview(null);
    setEntrancePreview(null);
  }, []);
  const canDrag = enabled && editing && dragEnabled && !viewport.panMode;
  const onResizeBusyChange = useCallback((busy: boolean) => {
    resizeLock.current = busy;
  }, []);
  const resize = useSpaceResize({
    bounds,
    enabled: canDrag,
    canStart: () => !drag.current && !saving.current,
    onResize: onResizeSpace,
    onSelect: setSelectedId,
    onSaveState: setSaveState,
    onBusyChange: onResizeBusyChange,
  });
  const onPointerCancel = useCallback(() => {
    cancelObjectDrag();
    resize.cancel();
  }, [cancelObjectDrag, resize.cancel]);
  useEffect(() => {
    if (!canDrag) onPointerCancel();
  }, [canDrag, onPointerCancel]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag.current) {
        event.preventDefault();
        onPointerCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onPointerCancel]);

  function begin(event: ReactPointerEvent<SVGGElement>, pending: boolean) {
    if (
      !canDrag ||
      pending ||
      saving.current ||
      resize.isBusy() ||
      drag.current ||
      event.button !== 0
    )
      return null;
    const point = pointerPosition(event);
    if (!point) return null;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    return point;
  }
  function onPointerDown(
    event: ReactPointerEvent<SVGGElement>,
    object: DraggableObject,
    pending: boolean,
  ) {
    const point = begin(event, pending);
    if (point)
      drag.current = {
        kind: "object",
        object,
        start: point,
        pointerId: event.pointerId,
        target: event.currentTarget,
        gesture: beginPointerGesture({ x: event.clientX, y: event.clientY }),
      };
  }
  function onEntrancePointerDown(
    event: ReactPointerEvent<SVGGElement>,
    entrance: EntranceDto,
    pending: boolean,
  ) {
    const center = entranceCenter(entrance, bounds);
    if (!center) return;
    const point = begin(event, pending);
    if (point) {
      drag.current = {
        kind: "entrance",
        entrance,
        pointerId: event.pointerId,
        target: event.currentTarget,
        gesture: beginPointerGesture({ x: event.clientX, y: event.clientY }),
        grabDelta: { x: point.x - center.x, y: point.y - center.y },
      };
    }
  }
  function positionFor(current: ObjectDrag, point: Point) {
    return positionAfterDrag(
      current.object,
      {
        x: point.x - current.start.x,
        y: point.y - current.start.y,
      },
      bounds,
    );
  }
  function entranceFor(current: EntranceDrag, point: Point) {
    return nearestEntrancePosition(
      { x: point.x - current.grabDelta.x, y: point.y - current.grabDelta.y },
      current.entrance.width,
      bounds,
      current.entrance.wall,
      current.entrance.spaceId,
    );
  }
  function onPointerMove(event: ReactPointerEvent<SVGGElement>) {
    if (!canDrag) {
      onPointerCancel();
      return;
    }
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.gesture = updatePointerGesture(current.gesture, "move", {
      x: event.clientX,
      y: event.clientY,
    });
    if (!current.gesture.dragging) return;
    const point = pointerPosition(event);
    if (!point) return;
    if (current.kind === "object")
      setPreview({ id: current.object.id, ...positionFor(current, point) });
    else {
      const position = entranceFor(current, point);
      setEntrancePreview(
        position ? { id: current.entrance.id, ...position } : null,
      );
    }
  }
  async function onPointerUp(event: ReactPointerEvent<SVGGElement>) {
    if (!canDrag) {
      onPointerCancel();
      return;
    }
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const intendedDrag = updatePointerGesture(current.gesture, "up", {
      x: event.clientX,
      y: event.clientY,
    }).dragging;
    // Calculate the endpoint before changing selection. A shorter aside can clamp page scroll
    // and change getScreenCTM(), even while the pointer has not physically moved.
    const point = intendedDrag ? pointerPosition(event) : null;
    const objectNext =
      intendedDrag && point && current.kind === "object"
        ? positionFor(current, point)
        : null;
    const entranceNext =
      intendedDrag && point && current.kind === "entrance"
        ? entranceFor(current, point)
        : null;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setSelectedId(
      current.kind === "object"
        ? current.object.id
        : `entrance:${current.entrance.id}`,
    );
    if (!intendedDrag || !point) {
      setPreview(null);
      setEntrancePreview(null);
      return;
    }
    try {
      if (current.kind === "object") {
        const next = objectNext!;
        if (next.x === current.object.x && next.y === current.object.y) return;
        setPreview({ id: current.object.id, ...next });
        saving.current = true;
        setSaveState("saving");
        await onMove(current.object.id, next);
      } else {
        const next = entranceNext;
        if (!next) return;
        if (
          next.wall === current.entrance.wall &&
          next.offset === current.entrance.offset &&
          next.spaceId === current.entrance.spaceId
        )
          return;
        setEntrancePreview({ id: current.entrance.id, ...next });
        saving.current = true;
        setSaveState("saving");
        await onMoveEntrance(current.entrance.id, next);
      }
      setSaveState("saved");
    } catch {
      setSaveState("error");
      // The typed command bridge retains the server error for the toolbar/details.
    } finally {
      saving.current = false;
      setPreview(null);
      setEntrancePreview(null);
    }
  }
  return {
    selectedId,
    setSelectedId,
    editing,
    ...viewport,
    setEditing: (value: SetStateAction<boolean>) => {
      onPointerCancel();
      setEditingState(value);
    },
    setPanMode: (value: SetStateAction<boolean>) => {
      onPointerCancel();
      viewport.setPanMode(value);
    },
    preview,
    entrancePreview,
    resizeSpacePreview: resize.preview,
    resizing: resize.resizing,
    resizeReadout: resize.preview
      ? `${resize.preview.width.toLocaleString("ru-RU")} × ${resize.preview.depth.toLocaleString("ru-RU")} м · ${(resize.preview.width * resize.preview.depth).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} м²`
      : null,
    onResizePointerDown: resize.onPointerDown,
    onResizePointerMove: resize.onPointerMove,
    onResizePointerUp: resize.onPointerUp,
    onResizePointerCancel: resize.onPointerCancel,
    onResizeLostPointerCapture: resize.onLostPointerCapture,
    canResizeSpaces: !!onResizeSpace,
    saveState,
    markSaved: () => setSaveState("saved"),
    onPointerDown,
    onEntrancePointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture: (event: ReactPointerEvent<SVGGElement>) => {
      if (drag.current?.pointerId === event.pointerId) onPointerCancel();
    },
  };
}
