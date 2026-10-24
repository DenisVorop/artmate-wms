import assert from "node:assert/strict";
import { test } from "node:test";
import { beginPointerGesture, updatePointerGesture } from "./pointer-gesture";
import {
  panKindForPress,
  clickAfterMapPress,
  scrollAfterMapPan,
  isMapObjectTarget,
} from "./map-navigation";

const background = {
  background: true,
  handMode: false,
  drawing: false,
  disabled: false,
  canNavigate: true,
  primary: true,
};
test("Пустой фон включает навигацию в обоих режимах; объект остаётся объектом, рука перехватывает всё", () => {
  assert.equal(panKindForPress(background), "background");
  assert.equal(panKindForPress({ ...background, background: false }), null);
  assert.equal(
    panKindForPress({ ...background, background: false, handMode: true }),
    "hand",
  );
  assert.equal(panKindForPress({ ...background, drawing: true }), null);
  assert.equal(
    panKindForPress({ ...background, drawing: true, handMode: true }),
    "hand",
  );
  for (const blocked of [
    { disabled: true },
    { canNavigate: false },
    { primary: false },
  ]) {
    assert.equal(panKindForPress({ ...background, ...blocked }), null);
    assert.equal(
      panKindForPress({ ...background, ...blocked, handMode: true }),
      null,
    );
  }
});
test("Короткий пустой клик очищает выделение; 5px pan, возврат назад, hand и cancel подавляют последующий click", () => {
  const press = beginPointerGesture({ x: 100, y: 200 });
  const jitter = updatePointerGesture(press, "move", { x: 103, y: 202 });
  assert.equal(clickAfterMapPress("background", jitter, false), "clear");
  assert.equal(
    clickAfterMapPress(
      "background",
      updatePointerGesture(jitter, "up", { x: 300, y: 400 }),
      false,
    ),
    "clear",
  );
  const drag = updatePointerGesture(press, "move", { x: 103, y: 204 });
  assert.equal(clickAfterMapPress("background", drag, false), "suppress");
  assert.equal(
    clickAfterMapPress(
      "background",
      updatePointerGesture(drag, "move", { x: 100, y: 200 }),
      false,
    ),
    "suppress",
  );
  assert.equal(clickAfterMapPress("hand", press, false), "suppress");
  assert.equal(clickAfterMapPress("background", drag, true), "suppress");
  assert.equal(clickAfterMapPress("background", press, true), "suppress");
  // A later fresh press is independent of the cancelled gesture.
  assert.equal(
    clickAfterMapPress(
      "background",
      beginPointerGesture({ x: 150, y: 250 }),
      false,
    ),
    "clear",
  );
});
test("Pan двигает обе оси в направлении указателя, без изменения координат складских объектов", () => {
  const scroll = { left: 500, top: 600 },
    start = { x: 300, y: 400 };
  assert.deepEqual(scrollAfterMapPan(scroll, start, { x: 350, y: 370 }), {
    left: 450,
    top: 630,
  });
  assert.deepEqual(scrollAfterMapPan(scroll, start, { x: 250, y: 430 }), {
    left: 550,
    top: 570,
  });
  assert.deepEqual(scrollAfterMapPan(scroll, start, start), scroll);
  assert.deepEqual(scroll, { left: 500, top: 600 });
});
test("SVG descendants и resize handles классифицируются через closest; пустой SVG/обёртка и неизвестный target безопасны", () => {
  let selector = "";
  const child = {
    closest: (value: string) => {
      selector = value;
      return { dataset: { mapObject: "space:room" } };
    },
  };
  assert.equal(isMapObjectTarget(child), true);
  assert.equal(selector, "[data-map-object]");
  assert.equal(isMapObjectTarget({ parentElement: child }), true);
  assert.equal(
    isMapObjectTarget({
      closest: () => ({ dataset: { mapObject: "resize:room:se" } }),
    }),
    true,
  );
  assert.equal(isMapObjectTarget({ closest: () => null }), false);
  for (const target of [
    null,
    undefined,
    {},
    "rect",
    { closest: true },
    { parentElement: null },
  ])
    assert.equal(isMapObjectTarget(target), false);
});
