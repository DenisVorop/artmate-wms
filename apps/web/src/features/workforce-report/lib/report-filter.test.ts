import assert from "node:assert/strict";
import test from "node:test";
import {
  reportDefaults,
  reportFilterSchema,
  reportQuery,
} from "./report-filter";

test("only valid inclusive periods of at most 366 days reach a query", () => {
  const valid = { from: "2024-01-01", to: "2024-12-31", employeeId: "" };
  assert.equal(reportFilterSchema.safeParse(valid).success, true);
  assert.equal(
    reportFilterSchema.safeParse({ ...valid, to: "2025-01-01" }).success,
    false,
  );
  assert.equal(
    reportFilterSchema.safeParse({ ...valid, to: "2023-12-31" }).success,
    false,
  );
  assert.throws(() =>
    reportQuery({ ...valid, from: "2026-02-30" }, true, "self"),
  );
});
test("employee scope ignores foreign deep links and forged dropdown values", () => {
  const values = reportDefaults(
    false,
    "own",
    "other",
    new Date("2026-10-23T22:00:00Z"),
  );
  assert.equal(values.employeeId, "own");
  assert.deepEqual(
    reportQuery({ ...values, employeeId: "other" }, false, "own"),
    { from: "2026-10-24", to: "2026-10-24", employeeId: "own" },
  );
  assert.equal(reportDefaults(true, "own", "other").employeeId, "other");
});
test("query keeps inclusive Moscow dates as date-only and omits all-employees filter", () => {
  assert.deepEqual(
    reportQuery(
      { from: "2026-10-01", to: "2026-10-24", employeeId: "  " },
      true,
      "self",
    ),
    { from: "2026-10-01", to: "2026-10-24" },
  );
});
