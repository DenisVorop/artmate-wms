export type ViewportSize = { width: number; height: number };
export type ViewportMetrics = ViewportSize & {
  pixelsPerMeter: number;
  canvasWidth: number;
  canvasHeight: number;
  insetX?: number;
  insetY?: number;
};
export const PLAN_PADDING = 1.4;
export const WORKING_PIXELS_PER_METER = 72;
export const MIN_PLAN_ZOOM = 0.25;
export const MAX_PLAN_ZOOM = 32;

export function planFitScale(
  plan: { width: number; depth: number },
  viewport: ViewportSize,
): number {
  if (viewport.width <= 0 || viewport.height <= 0) return 0;
  return Math.min(
    viewport.width / (plan.width + PLAN_PADDING * 2),
    viewport.height / (plan.depth + PLAN_PADDING * 2),
  );
}
export function clampPlanZoom(zoom: number) {
  return Math.max(MIN_PLAN_ZOOM, Math.min(MAX_PLAN_ZOOM, zoom));
}
export function viewportCanvasPoint(
  metrics: ViewportMetrics,
  scroll: { left: number; top: number },
  cursor: { x: number; y: number },
) {
  const left =
    metrics.insetX ?? Math.max(0, (metrics.width - metrics.canvasWidth) / 2);
  const top =
    metrics.insetY ?? Math.max(0, (metrics.height - metrics.canvasHeight) / 2);
  return {
    x: (scroll.left + cursor.x - left) / metrics.pixelsPerMeter,
    y: (scroll.top + cursor.y - top) / metrics.pixelsPerMeter,
  };
}
export function viewportCanvasCenter(
  metrics: ViewportMetrics,
  scroll: { left: number; top: number },
) {
  return viewportCanvasPoint(metrics, scroll, {
    x: metrics.width / 2,
    y: metrics.height / 2,
  });
}
export function scrollForCanvasPoint(
  metrics: ViewportMetrics,
  point: { x: number; y: number },
  cursor: { x: number; y: number },
) {
  const left =
    metrics.insetX ?? Math.max(0, (metrics.width - metrics.canvasWidth) / 2);
  const top =
    metrics.insetY ?? Math.max(0, (metrics.height - metrics.canvasHeight) / 2);
  const width =
    metrics.insetX === undefined
      ? Math.max(metrics.width, metrics.canvasWidth)
      : metrics.canvasWidth + metrics.insetX * 2;
  const height =
    metrics.insetY === undefined
      ? Math.max(metrics.height, metrics.canvasHeight)
      : metrics.canvasHeight + metrics.insetY * 2;
  return {
    left: Math.max(
      0,
      Math.min(
        Math.max(0, width - metrics.width),
        point.x * metrics.pixelsPerMeter + left - cursor.x,
      ),
    ),
    top: Math.max(
      0,
      Math.min(
        Math.max(0, height - metrics.height),
        point.y * metrics.pixelsPerMeter + top - cursor.y,
      ),
    ),
  };
}
export function scrollForCanvasCenter(
  metrics: ViewportMetrics,
  center: { x: number; y: number },
) {
  return scrollForCanvasPoint(metrics, center, {
    x: metrics.width / 2,
    y: metrics.height / 2,
  });
}
/** Native wheel units differ; ctrl-wheel represents a trackpad pinch in Chromium. */
export function wheelZoomFactor(
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
  pinch: boolean,
): number {
  const pixels =
    deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? viewportHeight : 1);
  const bounded = Math.max(-200, Math.min(200, pixels));
  return Math.exp(-bounded * (pinch ? 0.01 : 0.002));
}
export function shortScreenLabel(
  text: string,
  availablePixels: number,
  fontPixels = 12,
): string {
  const length = Math.max(1, Math.floor(availablePixels / (fontPixels * 0.65)));
  return text.length > length
    ? `${text.slice(0, Math.max(0, length - 1))}…`
    : text;
}
export function canShowObjectLabel(
  text: string,
  widthMeters: number,
  depthMeters: number,
  pixelsPerMeter: number,
): boolean {
  return (
    depthMeters * pixelsPerMeter >= 20 &&
    widthMeters * pixelsPerMeter >= text.length * 12 * 0.65 + 12
  );
}

export function scaleBar(pixelsPerMeter: number): {
  meters: number;
  widthPx: number;
} {
  const density =
    pixelsPerMeter > 0 ? pixelsPerMeter : WORKING_PIXELS_PER_METER;
  const magnitude = 10 ** Math.floor(Math.log10(80 / density));
  const meters = [1, 2, 5, 10]
    .map((step) => step * magnitude)
    .sort((a, b) => Math.abs(a * density - 80) - Math.abs(b * density - 80))[0];
  return { meters, widthPx: meters * density };
}
