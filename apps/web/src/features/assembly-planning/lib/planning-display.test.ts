import test from "node:test";
import assert from "node:assert/strict";
import { displayedPlanningPlan } from "./planning-display";

test("a settings transition cannot present provisional zero as a completed stock plan", () => {
  const provisional = { rows: [{ recommendedBoxes: 0, dataComplete: true }] };
  assert.equal(
    displayedPlanningPlan(provisional, null, { state: "unavailable" }),
    null,
  );
  // Row flags and nonzero fallback quantities do not establish publication.
  provisional.rows[0].recommendedBoxes = 376;
  assert.equal(
    displayedPlanningPlan(provisional, null, { state: "unavailable" }),
    null,
  );
});

test("a published plan with legitimate zero demand remains visible", () => {
  const published = { rows: [{ recommendedBoxes: 0 }] };
  assert.equal(
    displayedPlanningPlan(published, null, { state: "current" }),
    published,
  );
});

test("background refresh keeps the server-selected compatible previous plan", () => {
  const current = { rows: [{ recommendedBoxes: 0 }] };
  const previous = { rows: [{ recommendedBoxes: 376 }] };
  assert.equal(
    displayedPlanningPlan(current, previous, { state: "refreshing" }),
    previous,
  );
  assert.equal(
    displayedPlanningPlan(previous, null, { state: "refreshing" }),
    previous,
  );
});
