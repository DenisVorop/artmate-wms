import assert from "node:assert/strict";
import { test } from "node:test";
import { beginPointerGesture, updatePointerGesture } from "./pointer-gesture";

test("Обычный клик не становится перетаскиванием из-за скролла или изменения матрицы при отпускании", () => {
  const press = beginPointerGesture({ x: 200, y: 500 });
  assert.equal(
    updatePointerGesture(press, "up", { x: 200, y: 100 }).dragging,
    false,
  );
  const jitter = updatePointerGesture(press, "move", { x: 202, y: 502 });
  assert.equal(jitter.dragging, false);
  assert.equal(
    updatePointerGesture(jitter, "up", { x: 200, y: 100 }).dragging,
    false,
  );
});

test("Только явное движение на пять пикселей включает drag и сохраняет намерение до отпускания", () => {
  const press = beginPointerGesture({ x: 20, y: 30 });
  const drag = updatePointerGesture(press, "move", { x: 23, y: 34 });
  assert.equal(drag.dragging, true);
  assert.equal(
    updatePointerGesture(drag, "move", { x: 20, y: 30 }).dragging,
    true,
  );
  assert.equal(
    updatePointerGesture(drag, "up", { x: 20, y: 30 }).dragging,
    true,
  );
  assert.deepEqual(drag.startClient, { x: 20, y: 30 });
});
