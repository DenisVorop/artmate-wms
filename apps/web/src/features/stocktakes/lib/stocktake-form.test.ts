import assert from "node:assert/strict";
import test from "node:test";
import {
  stocktakeCreateSchema,
  stocktakeReasonSchema,
  validateScopeSize,
} from "./stocktake-form";
test("scope form requires the selected scope rather than leftover values from another choice", () => {
  assert.equal(
    stocktakeCreateSchema.safeParse({
      scope: "room",
      scopeId: "",
      locationIds: ["old"],
    }).success,
    false,
  );
  assert.equal(
    stocktakeCreateSchema.safeParse({
      scope: "locations",
      scopeId: "old",
      locationIds: [],
    }).success,
    false,
  );
  assert.equal(
    stocktakeCreateSchema.safeParse({
      scope: "locations",
      scopeId: "",
      locationIds: ["P-1"],
    }).success,
    true,
  );
  assert.equal(validateScopeSize(0) !== null, true);
  assert.equal(validateScopeSize(200), null);
  assert.notEqual(validateScopeSize(201), null);
});
test("consequential actions need a meaningful trimmed reason without silently accepting whitespace", () => {
  assert.equal(
    stocktakeReasonSchema.safeParse({ reason: "     " }).success,
    false,
  );
  assert.equal(
    stocktakeReasonSchema.safeParse({ reason: "   test   " }).success,
    false,
  );
  assert.equal(
    stocktakeReasonSchema.parse({ reason: "  Повторный пересчёт  " }).reason,
    "Повторный пересчёт",
  );
  assert.equal(
    stocktakeReasonSchema.safeParse({ reason: "x".repeat(501) }).success,
    false,
  );
});
