import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runMonthlyHybridForecast,
  applyMonthlySegment,
} from "../src/forecasting/monthly-hybrid";
import { runForecast } from "../src/forecasting/engine";
import type { ForecastSeries } from "../src/forecasting/engine-types";
function series(length: number): ForecastSeries {
  return {
    id: "one",
    provider: "ozon",
    storeId: "shop-1",
    externalId: "one",
    metric: "net_ordered",
    points: Array.from({ length }, (_, i) => ({
      date: new Date(Date.parse("2025-01-01") + i * 86400000)
        .toISOString()
        .slice(0, 10),
      units: i % 7 < 5 ? 10 : 40,
      availability: "unknown",
    })),
  };
}
test("180 known days validate the 30-day ML segment without requiring a 106-day ML proof", () => {
  const input = series(180),
    options = { asOf: input.points.at(-1)!.date, horizonDays: 106 };
  const hybrid = runMonthlyHybridForecast(input, options);
  assert.equal(hybrid.long.selectedModel, "mean");
  assert.equal(hybrid.monthly.selectedModel, "autoregressive");
  assert.equal(hybrid.usesMonthlyMl, true);
  const candidate = hybrid.monthly.candidates.find(
    (c) => c.model === "autoregressive",
  )!;
  assert.equal(candidate.eligible, true);
  assert.equal(
    candidate.metrics!.byHorizon.find((h) => h.horizonDays === 30)!.folds,
    3,
  );
  assert.deepEqual(
    hybrid.dailyForecast.slice(0, 30),
    hybrid.monthly.dailyForecast,
  );
  assert.deepEqual(
    hybrid.dailyForecast.slice(30),
    hybrid.long.dailyForecast.slice(30),
  );
  assert.equal(
    runForecast(input, options).candidates.find(
      (c) => c.model === "autoregressive",
    )!.eligible,
    false,
  );
});
test("short-data fallback is honest; a good 7-day fit does not become a claimed 30-day ML forecast", () => {
  for (const length of [56, 100]) {
    const input = series(length),
      hybrid = runMonthlyHybridForecast(input, {
        asOf: input.points.at(-1)!.date,
        horizonDays: 106,
      });
    assert.equal(hybrid.usesMonthlyMl, false);
    assert.equal(
      hybrid.monthly.candidates.find((c) => c.model === "autoregressive")!
        .eligible,
      false,
    );
    assert.deepEqual(hybrid.dailyForecast, hybrid.long.dailyForecast);
  }
  const short = series(100),
    hybrid = runMonthlyHybridForecast(short, {
      asOf: short.points.at(-1)!.date,
      horizonDays: 7,
    });
  assert.equal(hybrid.monthly.dailyForecast.length, 30);
  assert.equal(hybrid.usesMonthlyMl, false);
});
test("segment splice respects actual calendar dates and leaves every later tail value intact", () => {
  const input = series(180),
    hybrid = runMonthlyHybridForecast(input, {
      asOf: input.points.at(-1)!.date,
      horizonDays: 106,
    });
  const tail = hybrid.long.dailyForecast.map((p) => ({ ...p, units: 123 }));
  const spliced = applyMonthlySegment(hybrid.monthly, tail);
  assert.deepEqual(spliced.slice(0, 30), hybrid.monthly.dailyForecast);
  assert.ok(spliced.slice(30).every((p) => p.units === 123));
  assert.equal(spliced.length, 106);
  assert.ok(tail.every((p) => p.units === 123));
});
test("future injection cannot influence training, the 30-day decision, tail or fingerprint", () => {
  const input = series(180),
    options = { asOf: input.points.at(-1)!.date, horizonDays: 106 };
  const base = runMonthlyHybridForecast(input, options);
  const future = base.dailyForecast.map((p) => ({
    date: p.date,
    units: 9_999_999,
    availability: "available" as const,
  }));
  assert.deepEqual(
    runMonthlyHybridForecast(
      { ...input, points: [...input.points, ...future] },
      options,
    ),
    base,
  );
});
