"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";
import {
  panKindForPress,
  clickAfterMapPress,
  scrollAfterMapPan,
  type MapPanKind,
  type MapClickOutcome,
  type PanStartContext,
} from "./map-navigation";
import type { PlanBounds } from "./plan-geometry";
import {
  beginPointerGesture,
  updatePointerGesture,
  type PointerGesture,
} from "./pointer-gesture";
import {
  clampPlanZoom,
  planFitScale,
  openingRoomView,
  scrollForCanvasCenter,
  viewportCanvasCenter,
  viewportCanvasPoint,
  scrollForCanvasPoint,
  wheelZoomFactor,
  PLAN_PADDING,
  WORKING_PIXELS_PER_METER,
  type ViewportMetrics,
} from "./plan-viewport";

type Pan = {
  pointerId: number;
  kind: MapPanKind;
  x: number;
  y: number;
  left: number;
  top: number;
  target: HTMLDivElement;
  gesture: PointerGesture;
};
export function usePlanViewport(
  bounds: PlanBounds,
  enabled: boolean,
  canZoom: () => boolean = () => true,
) {
  const zoomPermission = useRef(canZoom);
  zoomPermission.current = canZoom;
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [navigation, setNavigation] = useState(0);
  const [view, setView] = useState({
    mode: "opening",
    density: WORKING_PIXELS_PER_METER,
  });
  const [panMode, setPanMode] = useState(false);
  const [panning, setPanning] = useState(false);
  const pan = useRef<Pan | null>(null);
  const clickOutcome = useRef<MapClickOutcome>("none");
  const previous = useRef<ViewportMetrics | null>(null);
  const savedScroll = useRef({ left: 0, top: 0 });
  const pendingAnchor = useRef<{
    point: { x: number; y: number };
    cursor: { x: number; y: number };
  } | null>(null);
  const pendingCenter = useRef<{ x: number; y: number } | null>(null);
  const fitPixelsPerMeter = planFitScale(bounds, size);
  const firstRoom =
    bounds.layoutMode === "spaces"
      ? (bounds.spaces?.find(
          (space) => !space.archived && space.kind === "room",
        ) ?? bounds.spaces?.find((space) => !space.archived))
      : undefined;
  const initial =
    firstRoom && fitPixelsPerMeter ? openingRoomView(firstRoom, size) : null;
  const initialX = initial?.center.x;
  const initialY = initial?.center.y;
  const requestedDensity =
    view.mode === "fit"
      ? fitPixelsPerMeter
      : view.mode === "opening" && initial
        ? initial.density
        : view.density;
  const zoom =
    fitPixelsPerMeter > 0
      ? clampPlanZoom(requestedDensity / fitPixelsPerMeter)
      : 1;
  const pixelsPerMeter =
    fitPixelsPerMeter > 0 ? fitPixelsPerMeter * zoom : WORKING_PIXELS_PER_METER;
  const canvasWidth = (bounds.width + PLAN_PADDING * 2) * pixelsPerMeter;
  const canvasHeight = (bounds.depth + PLAN_PADDING * 2) * pixelsPerMeter;
  const captureCenter = useCallback(() => {
    pendingAnchor.current = null;
    const metrics = previous.current,
      element = scrollRef.current;
    if (metrics && element)
      pendingCenter.current = viewportCanvasCenter(metrics, {
        left: element.scrollLeft,
        top: element.scrollTop,
      });
  }, []);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!enabled || !element) return;
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setSize((current) => {
        if (current.width === next.width && current.height === next.height)
          return current;
        const metrics = previous.current;
        if (metrics && !pendingCenter.current)
          pendingCenter.current = viewportCanvasCenter(
            metrics,
            savedScroll.current,
          );
        return next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const onScroll = () => {
      savedScroll.current = {
        left: element.scrollLeft,
        top: element.scrollTop,
      };
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", onScroll);
    };
  }, [enabled]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!enabled || !element || !size.width || !size.height) return;
    const metrics = {
      ...size,
      pixelsPerMeter,
      canvasWidth,
      canvasHeight,
      insetX: size.width,
      insetY: size.height,
    };
    const center =
      pendingCenter.current ??
      (previous.current
        ? viewportCanvasCenter(previous.current, savedScroll.current)
        : {
            x: initialX ?? size.width / (2 * pixelsPerMeter),
            y: initialY ?? size.height / (2 * pixelsPerMeter),
          });
    const next = pendingAnchor.current
      ? scrollForCanvasPoint(
          metrics,
          pendingAnchor.current.point,
          pendingAnchor.current.cursor,
        )
      : scrollForCanvasCenter(metrics, center);
    element.scrollLeft = next.left;
    element.scrollTop = next.top;
    savedScroll.current = next;
    previous.current = metrics;
    pendingCenter.current = null;
    pendingAnchor.current = null;
    setView((current) =>
      current.mode === "opening"
        ? { mode: "working", density: requestedDensity }
        : current,
    );
  }, [
    enabled,
    navigation,
    size.width,
    size.height,
    pixelsPerMeter,
    canvasWidth,
    canvasHeight,
    bounds.width,
    bounds.depth,
    initialX,
    initialY,
    requestedDensity,
  ]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!enabled || !element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const metrics = previous.current;
      if (
        pan.current ||
        !zoomPermission.current() ||
        !metrics ||
        !fitPixelsPerMeter
      )
        return;
      const rect = element.getBoundingClientRect();
      const cursor = {
        x: event.clientX - rect.left - element.clientLeft,
        y: event.clientY - rect.top - element.clientTop,
      };
      const point = viewportCanvasPoint(
        metrics,
        { left: element.scrollLeft, top: element.scrollTop },
        cursor,
      );
      const factor = wheelZoomFactor(
        event.deltaY,
        event.deltaMode,
        metrics.height,
        event.ctrlKey,
      );
      setView((current) => {
        const density =
          current.mode === "fit" ? fitPixelsPerMeter : current.density;
        const next =
          fitPixelsPerMeter *
          clampPlanZoom((density * factor) / fitPixelsPerMeter);
        if (Math.abs(next - density) < 1e-9) return current;
        pendingCenter.current = null;
        pendingAnchor.current = { point, cursor };
        return { mode: "custom", density: next };
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [enabled, fitPixelsPerMeter]);
  const setZoom = (value: SetStateAction<number>) => {
    if (pan.current || !fitPixelsPerMeter) return;
    captureCenter();
    const factor = typeof value === "function" ? value(zoom) : value;
    setView({
      mode: "custom",
      density: fitPixelsPerMeter * clampPlanZoom(factor),
    });
  };
  const fitPlan = () => {
    if (pan.current) return;
    setNavigation((value) => value + 1);
    pendingAnchor.current = null;
    pendingCenter.current = {
      x: bounds.width / 2 + PLAN_PADDING,
      y: bounds.depth / 2 + PLAN_PADDING,
    };
    setView({ mode: "fit", density: fitPixelsPerMeter });
  };
  const workingScale = () => {
    if (pan.current) return;
    captureCenter();
    setView({ mode: "working", density: WORKING_PIXELS_PER_METER });
  };
  const cancelPan = useCallback(() => {
    const current = pan.current;
    if (!current) return;
    pan.current = null;
    clickOutcome.current = clickAfterMapPress(
      current.kind,
      current.gesture,
      true,
    );
    if (current.target.hasPointerCapture(current.pointerId))
      current.target.releasePointerCapture(current.pointerId);
    setPanning(false);
  }, []);
  useEffect(() => {
    cancelPan();
  }, [panMode, enabled, cancelPan]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pan.current) {
        event.preventDefault();
        cancelPan();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelPan]);
  const onPanPointerDownCapture = (
    event: ReactPointerEvent<HTMLDivElement>,
    context: PanStartContext = {},
  ) => {
    if (pan.current || event.button !== 0) return;
    clickOutcome.current = "none";
    const kind = panKindForPress({
      ...context,
      handMode: panMode,
      canNavigate: enabled && zoomPermission.current(),
      primary: event.button === 0,
    });
    if (!kind) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pan.current = {
      pointerId: event.pointerId,
      kind,
      x: event.clientX,
      y: event.clientY,
      left: event.currentTarget.scrollLeft,
      top: event.currentTarget.scrollTop,
      target: event.currentTarget,
      gesture: beginPointerGesture({ x: event.clientX, y: event.clientY }),
    };
  };
  const onPanPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = pan.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    current.gesture = updatePointerGesture(current.gesture, "move", {
      x: event.clientX,
      y: event.clientY,
    });
    if (!current.gesture.dragging) return;
    setPanning(true);
    const next = scrollAfterMapPan(
      { left: current.left, top: current.top },
      { x: current.x, y: current.y },
      { x: event.clientX, y: event.clientY },
    );
    current.target.scrollLeft = next.left;
    current.target.scrollTop = next.top;
  };
  const onPanPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pan.current || pan.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const current = pan.current;
    pan.current = null;
    clickOutcome.current = clickAfterMapPress(
      current.kind,
      current.gesture,
      false,
    );
    if (current.target.hasPointerCapture(current.pointerId))
      current.target.releasePointerCapture(current.pointerId);
    setPanning(false);
  };
  const onPanClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return "none" as const;
    const result = clickOutcome.current;
    clickOutcome.current = "none";
    if (result !== "none" || panMode) {
      event.preventDefault();
      event.stopPropagation();
      return panMode ? ("suppress" as const) : result;
    }
    return "none" as const;
  };
  return {
    zoom,
    setZoom,
    zoomIn: () => setZoom(zoom * 1.25),
    zoomOut: () => setZoom(zoom / 1.25),
    fitPlan,
    workingScale,
    pixelsPerMeter,
    fitPixelsPerMeter,
    canvasWidth,
    canvasHeight,
    viewportWidth: size.width,
    viewportHeight: size.height,
    canvasInsetX: size.width,
    canvasInsetY: size.height,
    scrollRef,
    svgRef,
    panMode,
    setPanMode,
    panning,
    onPanPointerDownCapture,
    onPanPointerMove,
    onPanPointerUp,
    onPanPointerCancel: cancelPan,
    onPanLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (pan.current?.pointerId === event.pointerId) cancelPan();
    },
    onPanClickCapture,
  };
}
