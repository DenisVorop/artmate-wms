import test from "node:test";
import assert from "node:assert/strict";
import {
  planningDefaults,
  planningSchema,
  transitSchema,
} from "./planning-form";
test("plan accepts defaults and rejects invalid periods", () => {
  assert.deepEqual(planningSchema.parse(planningDefaults), planningDefaults);
  assert.equal(
    planningSchema.safeParse({ ...planningDefaults, historyDays: 0 }).success,
    false,
  );
  assert.equal(
    planningSchema.safeParse({ ...planningDefaults, horizonDays: 1.5 }).success,
    false,
  );
  assert.equal(
    planningSchema.safeParse({ ...planningDefaults, leadDays: -1 }).success,
    false,
  );
});
test("unknown transit stays unknown until an explicit nonnegative integer including zero", () => {
  for (const value of [undefined, null, "", Number.NaN, -1, 0.5])
    assert.equal(
      transitSchema.safeParse({ inTransitUnits: value }).success,
      false,
    );
  assert.deepEqual(transitSchema.parse({ inTransitUnits: 0 }), {
    inTransitUnits: 0,
  });
  assert.deepEqual(transitSchema.parse({ inTransitUnits: 125 }), {
    inTransitUnits: 125,
  });
});
