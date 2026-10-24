import assert from "node:assert/strict";
import { test } from "node:test";
import {
  viewportCanvasPoint,
  scrollForCanvasPoint,
  wheelZoomFactor,
  clampPlanZoom,
  type ViewportMetrics,
} from "./plan-viewport";
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
test("Колесо удерживает произвольную точку под курсором на увеличенном и узком fit полотне со свободным pan", () => {
  for (const metrics of [
    {
      width: 600,
      height: 660,
      pixelsPerMeter: 72,
      canvasWidth: 1929.6,
      canvasHeight: 2649.6,
      insetX: 600,
      insetY: 660,
    },
    {
      width: 600,
      height: 660,
      pixelsPerMeter: 10,
      canvasWidth: 268,
      canvasHeight: 368,
      insetX: 600,
      insetY: 660,
    },
  ] satisfies ViewportMetrics[]) {
    const cursor = { x: 477, y: 123 },
      scroll = { left: 450, top: 530 };
    const point = viewportCanvasPoint(metrics, scroll, cursor);
    for (const factor of [1.4, 0.6]) {
      const nextMetrics = {
        ...metrics,
        pixelsPerMeter: metrics.pixelsPerMeter * factor,
        canvasWidth: metrics.canvasWidth * factor,
        canvasHeight: metrics.canvasHeight * factor,
      };
      const nextScroll = scrollForCanvasPoint(nextMetrics, point, cursor);
      const nextPoint = viewportCanvasPoint(nextMetrics, nextScroll, cursor);
      close(nextPoint.x, point.x);
      close(nextPoint.y, point.y);
    }
  }
});
test("Единицы wheel нормализуются, ctrl-pinch плавный, масштаб ограничивается текущим диапазоном", () => {
  close(wheelZoomFactor(1, 1, 660, false), wheelZoomFactor(16, 0, 660, false));
  close(wheelZoomFactor(1, 2, 660, false), wheelZoomFactor(660, 0, 660, false));
  assert.ok(wheelZoomFactor(-2, 0, 660, true) > 1);
  assert.ok(wheelZoomFactor(-2, 0, 660, true) < 1.1);
  assert.ok(wheelZoomFactor(100, 0, 660, false) < 1);
  assert.equal(wheelZoomFactor(0, 0, 660, false), 1);
  assert.equal(clampPlanZoom(1000), 32);
  assert.equal(clampPlanZoom(0.0001), 0.25);
});
