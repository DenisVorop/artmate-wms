import { test } from "node:test";
import assert from "node:assert/strict";
import {
  forecastPolicySchema,
  financeSchema,
  historyPeriod,
  policyCommand,
} from "./forecast-form";
import { forecastChart } from "./chart";
test("minimum stock accepts whole boxes, including zero, but never silently rounds invalid input", () => {
  assert.deepEqual(
    policyCommand(
      "cats",
      { minimumBoxes: 1, seasonalityEnabled: true },
      "request",
    ),
    {
      requestId: "request",
      skuId: "cats",
      minimumBoxes: 1,
      seasonalityEnabled: true,
    },
  );
  for (const n of [-1, 1.2, NaN, 1001])
    assert.equal(
      forecastPolicySchema.safeParse({
        minimumBoxes: n,
        seasonalityEnabled: true,
      }).success,
      false,
    );
  assert.equal(
    forecastPolicySchema.safeParse({
      minimumBoxes: 0,
      seasonalityEnabled: false,
    }).success,
    true,
  );
  assert.equal(financeSchema.safeParse({ apiKey: "   " }).success, false);
  assert.equal(
    financeSchema.parse({ apiKey: "  temporary  " }).apiKey,
    "temporary",
  );
});
test("historical backfill uses the last complete Moscow day across UTC midnight and leap years", () => {
  assert.deepEqual(historyPeriod(new Date("2026-10-25T21:01:00Z")), {
    from: "2024-01-29",
    to: "2026-10-25",
  });
  assert.equal(
    historyPeriod(new Date("2026-10-25T20:59:00Z")).to,
    "2026-10-24",
  );
  assert.equal(
    historyPeriod(new Date("2024-03-01T00:00:00Z")).to,
    "2024-02-29",
  );
});
test("chart leaves gaps in unknown facts instead of connecting missing days or treating them as zero", () => {
  const chart = forecastChart([
    { date: "2026-10-01", actual: 3, predicted: null },
    { date: "2026-10-02", actual: null, predicted: null },
    { date: "2026-10-03", actual: 2, predicted: 0 },
  ]);
  assert.equal((chart.actual.match(/M/g) ?? []).length, 2);
  assert.equal(chart.actual.includes("L"), false);
  assert.equal(chart.predicted.includes("NaN"), false);
  assert.equal(chart.hasData, true);
  assert.equal(forecastChart([]).hasData, false);
  assert.equal(
    forecastChart([{ date: "2026-10-01", actual: 0, predicted: 0 }]).max,
    1,
  );
});
