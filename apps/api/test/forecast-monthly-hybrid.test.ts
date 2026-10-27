import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runMonthlyHybridForecast,
  applyMonthlySegment,
  applyForecastSegment,
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
    hybrid.dailyForecast.slice(59),
    hybrid.long.dailyForecast.slice(59),
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
test("segment splice preserves dates and reconciles its terminal level before restoring the original tail", () => {
  const input = series(180),
    hybrid = runMonthlyHybridForecast(input, {
      asOf: input.points.at(-1)!.date,
      horizonDays: 106,
    });
  const tail = hybrid.long.dailyForecast.map((p) => ({ ...p, units: 123 }));
  const spliced = applyMonthlySegment(hybrid.monthly, tail);
  assert.deepEqual(spliced.slice(0, 30), hybrid.monthly.dailyForecast);
  assert.equal(spliced[30].units, hybrid.monthly.dailyForecast.at(-1)!.units);
  assert.ok(spliced.slice(59).every((p) => p.units === 123));
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

test("validated monthly annual season keeps its dated evidence while the transition policy remains separate", () => {
  const input = series(600);
  input.points = input.points.map((p, i) => ({
    ...p,
    date: new Date(Date.parse("2024-01-01") + i * 86400000)
      .toISOString()
      .slice(0, 10),
    units: 30 + 25 * Math.sin((2 * Math.PI * i) / 365),
  }));
  const hybrid = runMonthlyHybridForecast(input, {
    asOf: input.points.at(-1)!.date,
    horizonDays: 106,
  });
  assert.notEqual(hybrid.long.selectedModel, "autoregressive");
  assert.ok(
    ["annual_seasonal", "annual_growth"].includes(hybrid.monthly.selectedModel),
  );
  assert.equal(hybrid.usesMonthlyForecast, true);
  assert.equal(hybrid.usesMonthlySeasonal, true);
  assert.equal(hybrid.usesMonthlyMl, false);
  assert.deepEqual(
    hybrid.dailyForecast.slice(0, 30),
    hybrid.monthly.dailyForecast,
  );
  assert.deepEqual(
    hybrid.dailyForecast.slice(59),
    hybrid.long.dailyForecast.slice(59),
  );
  assert.equal(hybrid.dailyForecast[30].units, hybrid.dailyForecast[29].units);
});

test("terminal month-to-tail correction has no day-30 cliff and bounded smooth log slope", () => {
  const dates = Array.from({ length: 106 }, (_, index) =>
    new Date(Date.parse("2026-10-27") + index * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );
  const segment = dates.slice(0, 30).map((date) => ({ date, units: 31.14 }));
  const tail = dates.map((date) => ({ date, units: 10.17 }));
  const frozen = JSON.stringify({ segment, tail });
  const merged = applyForecastSegment(segment, tail);
  assert.equal(merged[29].units, 31.14);
  assert.equal(merged[30].units, 31.14);
  for (let index = 31; index < 60; index++) {
    assert.ok(merged[index].units <= merged[index - 1].units);
    assert.ok(
      Math.abs(Math.log(merged[index].units / merged[index - 1].units)) <=
        (1.5 * Math.abs(Math.log(31.14 / 10.17))) / 29 + 1e-6,
    );
  }
  assert.deepEqual(merged.slice(59), tail.slice(59));
  assert.deepEqual(
    merged.map((point) => point.date),
    dates,
  );
  assert.equal(JSON.stringify({ segment, tail }), frozen);
});

test("zero terminal or zero tail levels reconcile without division, negative forecasts or NaN", () => {
  const dates = Array.from({ length: 70 }, (_, index) =>
    new Date(Date.parse("2026-10-27") + index * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );
  for (const [terminal, baseline] of [
    [0, 10],
    [10, 0],
    [0, 0],
  ]) {
    const tail = dates.map((date) => ({ date, units: baseline }));
    const segment = dates
      .slice(0, 30)
      .map((date) => ({ date, units: terminal }));
    const result = applyForecastSegment(segment, tail);
    assert.equal(result[30].units, terminal);
    assert.ok(
      result.every((point) => Number.isFinite(point.units) && point.units >= 0),
    );
    assert.deepEqual(result.slice(59), tail.slice(59));
  }
});

test("transition is calendar dated and never shifts missing target dates or modifies an ineligible segment", () => {
  const dates = Array.from({ length: 70 }, (_, index) =>
    new Date(Date.parse("2026-10-27") + index * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );
  const tail = dates
    .filter((_, index) => index < 31 || index > 40)
    .map((date) => ({ date, units: 10 }));
  const segment = dates.slice(0, 30).map((date) => ({ date, units: 30 }));
  const result = applyForecastSegment(segment, tail);
  assert.deepEqual(
    result.map((point) => point.date),
    tail.map((point) => point.date),
  );
  assert.deepEqual(
    result.filter((point) => point.date >= dates[59]),
    tail.filter((point) => point.date >= dates[59]),
  );
  const fallback = runForecast(series(56), {
    asOf: series(56).points.at(-1)!.date,
    horizonDays: 30,
  });
  assert.deepEqual(applyMonthlySegment(fallback, tail), tail);
  assert.deepEqual(applyForecastSegment([], tail), tail);
});
