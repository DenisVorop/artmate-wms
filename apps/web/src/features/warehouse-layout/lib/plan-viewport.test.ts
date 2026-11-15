import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canShowObjectLabel,
  clampPlanZoom,
  planFitScale,
  openingRoomView,
  scaleBar,
  scrollForCanvasCenter,
  shortScreenLabel,
  viewportCanvasCenter,
  type ViewportMetrics,
} from "./plan-viewport";

test("Рабочая плотность 72 не зависит от fit портретного плана, а zoom ограничен .25..32", () => {
  const fit = planFitScale(
    { width: 24, depth: 34 },
    { width: 600, height: 660 },
  );
  assert.ok(fit < 20);
  assert.equal(fit * clampPlanZoom(72 / fit), 72);
  assert.equal(clampPlanZoom(0.01), 0.25);
  assert.equal(clampPlanZoom(100), 32);
});

test("Начальный вид помещает первое помещение целиком при узкой карте", () => {
  const room = { x: 5, y: 2, width: 7.6, depth: 6.52 };
  const view = openingRoomView(room, { width: 480, height: 600 });
  assert.equal(view.density * room.width, 448);
  assert.equal(view.center.x, 10.2);
  const roomTop = 300 - (view.center.y - room.y - 1.4) * view.density;
  assert.ok(Math.abs(roomTop - 16) < 1e-9);
  assert.ok(roomTop + room.depth * view.density <= 584);
  assert.equal(openingRoomView(room, { width: 900, height: 800 }).density, 72);
});

test("Увеличение сохраняет координату центра видимой части, включая центрированный fit", () => {
  const initial: ViewportMetrics = {
    width: 600,
    height: 660,
    pixelsPerMeter: 72,
    canvasWidth: 1929.6,
    canvasHeight: 2649.6,
  };
  const center = viewportCanvasCenter(initial, { left: 400, top: 500 });
  const enlarged = {
    ...initial,
    pixelsPerMeter: 144,
    canvasWidth: initial.canvasWidth * 2,
    canvasHeight: initial.canvasHeight * 2,
  };
  const nextScroll = scrollForCanvasCenter(enlarged, center);
  const nextCenter = viewportCanvasCenter(enlarged, nextScroll);
  assert.ok(Math.abs(nextCenter.x - center.x) < 1e-9);
  assert.ok(Math.abs(nextCenter.y - center.y) < 1e-9);
  const fit = {
    ...initial,
    pixelsPerMeter: 10,
    canvasWidth: 268,
    canvasHeight: 368,
  };
  assert.deepEqual(scrollForCanvasCenter(fit, center), { left: 0, top: 0 });
  assert.deepEqual(viewportCanvasCenter(fit, { left: 0, top: 0 }), {
    x: 13.4,
    y: 18.4,
  });
});

test("Секция 1.3×0.9 показывает код рабочим шрифтом, слишком малая секция требует выноски", () => {
  assert.equal(canShowObjectLabel("A-01-01", 1.3, 0.9, 72), true);
  assert.equal(canShowObjectLabel("A-01-01", 0.1, 0.1, 72), false);
  assert.equal(canShowObjectLabel("A-01-01", 1.3, 0.9, 10), false);
  assert.equal(
    shortScreenLabel("Очень длинное имя помещения", 80, 12).endsWith("…"),
    true,
  );
  assert.deepEqual(scaleBar(72), { meters: 1, widthPx: 72 });
  assert.equal(scaleBar(16).meters, 5);
});
