import test from "node:test";
import assert from "node:assert/strict";
import { planningDefaults, planningSchema } from "./planning-form";
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
