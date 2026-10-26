import { test } from "node:test";
import assert from "node:assert/strict";
import { runForecast } from "../src/forecasting/engine";
import { demandBaseline } from "../src/forecasting/demand-baseline";
import { fitAutoregressive } from "../src/forecasting/engine-autoregressive";
import { newYearScenario } from "../src/forecasting/new-year-scenario";
import type {
  ForecastPoint,
  ForecastSeries,
} from "../src/forecasting/engine-types";
function points(
  length: number,
  units: (i: number) => number = () => 10,
  start = "2025-01-01",
): ForecastPoint[] {
  return Array.from({ length }, (_, i) => ({
    date: new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10),
    units: units(i),
    availability: "unknown",
  }));
}
const series = (data: ForecastPoint[]): ForecastSeries => ({
  id: "theme",
  provider: "ozon",
  storeId: "store-1",
  externalId: "one",
  metric: "net_ordered",
  points: data,
});
test("a locally trained autoregression learns weekly demand with under one year and beats matching holdouts", () => {
  const data = points(180, (i) => (i % 7 < 5 ? 10 : 40)),
    result = runForecast(series(data), {
      asOf: data.at(-1)!.date,
      horizonDays: 28,
    });
  const ml = result.candidates.find((c) => c.model === "autoregressive")!;
  assert.equal(result.selectedModel, "autoregressive");
  assert.equal(ml.eligible, true);
  assert.equal(
    ml.metrics!.byHorizon.find((h) => h.horizonDays === 28)!.folds,
    3,
  );
  assert.ok(ml.metrics!.baselineImprovement! > 0.5);
  assert.ok(
    result.dailyForecast.some((p) => p.units > 30) &&
      result.dailyForecast.some((p) => p.units < 15),
  );
  assert.ok(result.historyCoverage.knownDays < 400);
});
test("56 days never promises ML; short-horizon evidence cannot authorize an untested long forecast", () => {
  for (const length of [56, 100]) {
    const data = points(length, (i) => (i % 7 < 5 ? 10 : 40)),
      result = runForecast(series(data), {
        asOf: data.at(-1)!.date,
        horizonDays: 77,
      });
    const ml = result.candidates.find((c) => c.model === "autoregressive")!;
    assert.equal(ml.eligible, false);
    assert.equal(result.selectedModel, "mean");
    assert.match(ml.reason!, length === 56 ? /70/ : /трёх/);
  }
});
test("recursive ML and fitted identity never read injected future sales", () => {
  const data = points(180, (i) => (i % 7 < 5 ? 10 : 40)),
    asOf = data.at(-1)!.date;
  const base = runForecast(series(data), { asOf, horizonDays: 28 });
  const future = points(28, () => 999_999, base.dailyForecast[0].date);
  assert.deepEqual(
    runForecast(series([...data, ...future]), { asOf, horizonDays: 28 }),
    base,
  );
  const repeated = runForecast(series(data), { asOf, horizonDays: 28 });
  assert.deepEqual(repeated, base);
});
test("new item counts known days after observation; unknown and stockout days are not prelaunch zeros", () => {
  const data = points(56, () => 10);
  for (let i = 0; i < 42; i++) data[i].units = null;
  data[44] = { ...data[44], units: 0, availability: "out_of_stock" };
  data[45].units = null;
  const end = data.at(-1)!.date,
    result = demandBaseline(data, end, 14, 56);
  assert.equal(result.knownDays, 12);
  assert.equal(
    result.dailyForecast.reduce((n, p) => n + p.units, 0),
    140,
  );
  const withKnownZero = data.map((p) => ({ ...p }));
  withKnownZero[46].units = 0;
  assert.ok(
    demandBaseline(withKnownZero, end, 14, 56).dailyForecast[0].units < 10,
  );
});
test("a single spike cannot establish growth; sustained changes adapt without exponential extrapolation", () => {
  const flat = points(56),
    spike = points(56, (i) => (i === 55 ? 1000 : 10)),
    growth = points(56, (i) => (i >= 49 ? 15 : 10)),
    end = flat.at(-1)!.date;
  const spikeForecast = demandBaseline(spike, end, 366, 56),
    growthForecast = demandBaseline(growth, end, 366, 56);
  assert.ok(spikeForecast.dailyForecast[0].units < 15);
  assert.ok(growthForecast.dailyForecast[0].units > 10);
  assert.ok(
    growthForecast.dailyForecast[365].units <=
      growthForecast.dailyForecast[0].units,
  );
  assert.ok(growthForecast.dailyForecast.every((p) => p.units < 16));
  const sparse = points(56, (i) => (i === 55 ? 20 : 0));
  const sparseForecast = demandBaseline(sparse, end, 28, 56);
  assert.equal(sparseForecast.recentTrend, 1);
  assert.ok(sparseForecast.dailyForecast[0].units < 1);
  const bulk = demandBaseline(
    points(56, (i) => (i === 55 ? 1000 : 0)),
    end,
    77,
    56,
  );
  const one = demandBaseline(
    points(56, (i) => (i === 55 ? 1 : 0)),
    end,
    77,
    56,
  );
  assert.ok(Math.abs(bulk.dailyForecast[0].units - 1000 / 56) < 1e-6);
  assert.ok(Math.abs(one.dailyForecast[0].units - 1 / 56) < 1e-6);
  assert.ok(
    Math.abs(
      bulk.dailyForecast.reduce((n, p) => n + p.units, 0) - (1000 * 77) / 56,
    ) < 1e-4,
  );
  assert.equal(bulk.recentTrend, 1);
});
test("New Year is an explicit observed-trend scenario limited to the same holiday period, without fixed uplift", () => {
  const data = points(56, (i) => (i >= 49 ? 15 : 10), "2025-10-21"),
    asOf = data.at(-1)!.date;
  const scenario = newYearScenario(data, asOf, 60, 56),
    base = demandBaseline(data, asOf, 60, 56);
  assert.equal(scenario.scenario, true);
  assert.match(scenario.message, /Годовая сезонность пока не подтверждена/);
  for (let i = 0; i < scenario.dailyForecast.length; i++) {
    const p = scenario.dailyForecast[i];
    if (p.date.startsWith("2026"))
      assert.equal(p.units, base.dailyForecast[i].units);
    else assert.ok(p.units <= 15);
  }
  const constant = newYearScenario(
    points(56, () => 10, "2025-10-21"),
    asOf,
    60,
    56,
  );
  assert.equal(constant.scenario, false);
  assert.ok(constant.dailyForecast.every((p) => p.units === 10));
  const autumn = points(56, (i) => (i >= 49 ? 15 : 10), "2025-05-01");
  assert.equal(
    newYearScenario(autumn, autumn.at(-1)!.date, 330, 56).scenario,
    false,
  );
});
test("calendar-scenario mean is the very same deployed fallback used in validation", () => {
  const data = points(56, (i) => (i >= 49 ? 15 : 10), "2025-10-21"),
    asOf = data.at(-1)!.date;
  const engine = runForecast(series(data), {
    asOf,
    horizonDays: 60,
    newYearScenario: true,
  });
  const fallback = newYearScenario(data, asOf, 60, 56);
  assert.equal(engine.selectedModel, "mean");
  assert.equal(engine.scenario, true);
  engine.dailyForecast.forEach((p, i) =>
    assert.ok(Math.abs(p.units - fallback.dailyForecast[i].units) < 1e-6),
  );
});
test("models reject missing lag history, remain nonnegative and bounded over the maximum planning interval", () => {
  const data = points(180, (i) => (i % 7 < 5 ? 10 : 40));
  for (let i = 140; i < 178; i++) data[i].units = null;
  const result = runForecast(series(data), {
    asOf: data.at(-1)!.date,
    horizonDays: 336,
  });
  assert.equal(
    result.candidates.find((c) => c.model === "autoregressive")!.eligible,
    false,
  );
  assert.ok(
    result.dailyForecast.length === 336 &&
      result.dailyForecast.every(
        (p) => Number.isFinite(p.units) && p.units >= 0,
      ),
  );
});

test("training uses observations older than a year and excludes the future instead of clipping to 365 days", () => {
  const daily = points(800, () => 10, "2023-01-01");
  const values = daily.map((p) => ({
    day: Date.parse(p.date) / 86400000,
    units: p.units!,
  }));
  const changed = values.map((p, i) => ({
    ...p,
    units: i < 400 && i % 7 >= 5 ? 40 : p.units,
  }));
  const asOf = values.at(-1)!.day;
  assert.deepEqual(values.slice(-365), changed.slice(-365));
  const fit = fitAutoregressive(values, asOf, 30, 56),
    historical = fitAutoregressive(changed, asOf, 30, 56);
  assert.ok(fit.values && historical.values);
  assert.ok(
    fit.values.some((v, i) => Math.abs(v - historical.values![i]) > 0.1),
    "old known sales must influence learned coefficients",
  );
  assert.deepEqual(
    fitAutoregressive(
      [...changed, { day: asOf + 1, units: 999999 }],
      asOf,
      30,
      56,
    ),
    historical,
  );
  assert.ok(historical.values.every((v) => Number.isFinite(v) && v >= 0));
});
