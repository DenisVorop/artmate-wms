import { test } from "node:test";
import assert from "node:assert/strict";
import { runForecast, FORECAST_MODEL_VERSION } from "../src/forecasting/engine";
import type {
  ForecastPoint,
  ForecastSeries,
} from "../src/forecasting/engine-types";

const DAY = 86_400_000;
function points(
  length: number,
  units: (index: number, date: Date) => number | null = () => 10,
  start = "2024-01-01",
): ForecastPoint[] {
  const base = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length }, (_, index) => {
    const date = new Date(base + index * DAY);
    return {
      date: date.toISOString().slice(0, 10),
      units: units(index, date),
      availability: "available",
    };
  });
}
function series(data: ForecastPoint[]): ForecastSeries {
  return {
    id: "theme-cats",
    provider: "ozon",
    storeId: "shop-1",
    externalId: "cat-1",
    metric: "net_ordered",
    points: data,
  };
}
function forecast(data: ForecastPoint[], horizonDays = 77) {
  return runForecast(series(data), { asOf: data.at(-1)!.date, horizonDays });
}

test("short history uses the current mean and cannot claim learned annual seasonality", () => {
  const result = forecast(points(56), 28);
  assert.equal(result.selectedModel, "mean");
  assert.equal(result.totalUnits, 280);
  assert.equal(result.confidence, "low");
  assert.match(result.fallbackReason!, /400/);
  assert.equal(result.dailyForecast[0].date, "2024-02-26");
  assert.equal(result.dailyForecast.at(-1)!.date, "2024-03-24");
  assert.equal(result.historyCoverage.knownDays, 56);
  for (const candidate of result.candidates.filter((c) => c.model !== "mean")) {
    assert.equal(candidate.eligible, false);
    assert.match(candidate.reason!, /400/);
  }
});

test("constant demand retains the baseline; complexity earns no preference on ties", () => {
  const result = forecast(points(720));
  assert.equal(result.selectedModel, "mean");
  assert.equal(result.totalUnits, 770);
  assert.equal(result.modelVersion, FORECAST_MODEL_VERSION);
  assert.equal(result.confidence, "medium");
  assert.equal(result.candidates[0].metrics!.mae, 0);
  assert.equal(result.candidates[0].metrics!.wape, 0);
  assert.equal(result.candidates[0].metrics!.bias, 0);
  assert.equal(result.candidates[0].metrics!.folds, 9);
});

test("calendar winter peak is selected after repeated past tests, including tied flat periods", () => {
  const result = forecast(
    points(720, (_, date) => (date.getUTCMonth() >= 10 ? 50 : 5)),
  );
  assert.equal(result.selectedModel, "annual_seasonal");
  assert.ok(
    result.totalUnits < 1_000,
    "January forecast follows post-season low rather than December average",
  );
  const candidate = result.candidates.find(
    (c) => c.model === result.selectedModel,
  )!;
  assert.equal(candidate.eligible, true);
  assert.ok(candidate.metrics!.baselineImprovement! > 0.9);
  assert.deepEqual(
    candidate.metrics!.byHorizon.map((h) => [h.horizonDays, h.folds]),
    [
      [7, 3],
      [28, 3],
      [77, 3],
    ],
  );
  assert.equal(result.fallbackReason, null);
});

test("smooth annual seasonality and growth are learned without multiplying a seasonal lift twice", () => {
  const data = points(
    720,
    (i) => (30 + 25 * Math.sin((2 * Math.PI * i) / 365)) * (1 + i / 730),
  );
  const result = forecast(data);
  assert.notEqual(result.selectedModel, "mean");
  const currentYear = result.candidates.find(
    (c) => c.model === "annual_growth",
  )!;
  const ridge = result.candidates.find((c) => c.model === "ridge")!;
  assert.equal(currentYear.eligible, true);
  assert.equal(ridge.eligible, true);
  assert.ok(currentYear.metrics!.baselineImprovement! > 0.8);
  assert.ok(ridge.metrics!.baselineImprovement! > 0.8);
  assert.ok(result.totalUnits > 5_000 && result.totalUnits < 8_000);
  assert.ok(
    result.dailyForecast.every((p) => Number.isFinite(p.units) && p.units >= 0),
  );
});

test("ridge is a fitted candidate and a rising or declining series stays finite and nonnegative", () => {
  for (const factor of [1, -1]) {
    const result = forecast(points(730, (i) => 30 + factor * 0.03 * i));
    assert.ok(result.candidates.find((c) => c.model === "ridge")!.metrics);
    assert.ok(
      result.dailyForecast.every(
        (p) => Number.isFinite(p.units) && p.units >= 0,
      ),
    );
    assert.ok(result.totalUnits < 20_000);
  }
});

test("known zero demand has zero forecast and all-zero backtests have null WAPE, never NaN", () => {
  const result = forecast(points(720, () => 0));
  assert.equal(result.selectedModel, "mean");
  assert.equal(result.totalUnits, 0);
  assert.ok(result.dailyForecast.every((p) => p.units === 0));
  for (const candidate of result.candidates) {
    if (candidate.metrics) {
      assert.equal(candidate.metrics.wape, null);
      assert.equal(candidate.metrics.mae, 0);
      assert.equal(candidate.metrics.bias, 0);
      assert.equal(candidate.metrics.baselineImprovement, null);
    }
  }
});

test("null and missing days are unknown; stockout zeros do not reduce observed demand", () => {
  const data = points(56);
  for (let index = 10; index < 20; index++) data[index].units = null;
  for (let index = 20; index < 30; index++)
    data[index] = { ...data[index], units: 0, availability: "out_of_stock" };
  for (let index = 30; index < 40; index++)
    data[index].availability = "unknown";
  data.splice(0, 1);
  data.splice(5, 1);
  const result = forecast(data, 20);
  assert.equal(result.totalUnits, 200);
  assert.equal(result.historyCoverage.knownDays, 34);
  assert.equal(result.historyCoverage.missingDays, 11);
  assert.equal(result.historyCoverage.stockoutDays, 10);
  assert.equal(result.historyCoverage.unknownAvailabilityDays, 10);
  assert.equal(result.historyCoverage.availableDays, 24);
  assert.equal(result.historyCoverage.calendarDays, 55);
});

test("unknown historical availability does not discard real sales but caps confidence", () => {
  const data = points(
    1_200,
    (_, date) => 30 + 20 * Math.sin((2 * Math.PI * date.getUTCMonth()) / 12),
  );
  for (const point of data) point.availability = "unknown";
  const result = forecast(data);
  assert.equal(result.historyCoverage.knownDays, 1_200);
  assert.equal(result.historyCoverage.unknownAvailabilityDays, 1_200);
  assert.notEqual(result.confidence, "high");
  assert.ok(result.totalUnits > 0);
});

test("stockout-dominated annual data does not pass annual coverage gates", () => {
  const data = points(720);
  for (let index = 400; index < 620; index++)
    data[index].availability = "out_of_stock";
  const result = forecast(data);
  assert.equal(result.selectedModel, "mean");
  assert.match(result.candidates[1].reason!, /пропусков/);
  assert.equal(result.historyCoverage.stockoutDays, 220);
});

test("future values are excluded from training, validation, coverage, and fingerprint", () => {
  const prefix = points(
    720,
    (i) => 30 + 25 * Math.sin((2 * Math.PI * i) / 365),
  );
  const asOf = prefix.at(-1)!.date;
  const base = runForecast(series(prefix), { asOf, horizonDays: 28 });
  const future = points(25, () => 1_000_000, base.dailyForecast[0].date);
  const injected = runForecast(series([...prefix, ...future]), {
    asOf,
    horizonDays: 28,
  });
  assert.deepEqual(injected, base);
});

test("validation errors are prefix-only: late changes do not alter earlier held-out folds", () => {
  const data = points(720, (i) => 20 + 15 * Math.sin((2 * Math.PI * i) / 365));
  const earlyDate = data[599].date;
  const early = runForecast(series(data), { asOf: earlyDate, horizonDays: 28 });
  for (let index = 600; index < 720; index++) data[index].units = 50_000;
  const after = runForecast(series(data), { asOf: earlyDate, horizonDays: 28 });
  assert.deepEqual(after, early);
});

test("a long horizon cannot borrow short-horizon validation to pretend it is proven", () => {
  const result = forecast(
    points(720, (i) => 20 + 15 * Math.sin((2 * Math.PI * i) / 365)),
    330,
  );
  assert.equal(result.selectedModel, "mean");
  for (const candidate of result.candidates.filter((c) => c.model !== "mean")) {
    assert.equal(candidate.eligible, false);
    assert.match(candidate.reason!, /трёх полных проверок/);
    assert.ok(
      candidate.metrics!.folds >= 3,
      "short-horizon folds alone are insufficient",
    );
  }
});

test("a new or entirely unknown series is explicit low-confidence fallback, not confirmed zero sales", () => {
  const empty = runForecast(series([]), {
    asOf: "2026-10-25",
    horizonDays: 28,
  });
  assert.equal(empty.historyCoverage.from, null);
  assert.equal(empty.historyCoverage.coverageRatio, 0);
  assert.equal(empty.confidence, "low");
  assert.match(empty.fallbackReason!, /нет известных наблюдений/);
  const unknown = forecast(
    points(56, () => null),
    28,
  );
  assert.equal(unknown.historyCoverage.knownDays, 0);
  assert.equal(unknown.historyCoverage.missingDays, 56);
  assert.equal(unknown.confidence, "low");
  assert.match(unknown.fallbackReason!, /нет известных наблюдений/);
});

test("sparse demand and an extreme observation cannot yield NaN, negative demand or infinity", () => {
  const sparse = points(720, (i) => (i % 40 === 0 ? 8 : 0));
  const spike = points(720, () => 5);
  spike[719].units = 1_000_000_000;
  for (const data of [sparse, spike]) {
    const result = forecast(data, 330);
    assert.ok(Number.isFinite(result.totalUnits));
    assert.ok(
      result.totalUnits >= 0 && result.totalUnits <= 330 * 1_000_000_000,
    );
    assert.ok(
      result.dailyForecast.every(
        (p) => p.units >= 0 && Number.isFinite(p.units),
      ),
    );
    for (const candidate of result.candidates)
      if (candidate.metrics) {
        assert.ok(Number.isFinite(candidate.metrics.mae));
        assert.ok(Number.isFinite(candidate.metrics.bias));
        assert.ok(
          candidate.metrics.wape === null ||
            Number.isFinite(candidate.metrics.wape),
        );
      }
  }
});

test("calendar anniversaries and forecast dates handle February 29 and year boundaries", () => {
  const data = points(
    850,
    (_, date) => {
      const day = date.getUTCDate();
      return date.getUTCMonth() === 1 ? 30 + day / 10 : 5;
    },
    "2021-11-01",
  );
  const asOf = "2024-02-28";
  const result = runForecast(series(data), { asOf, horizonDays: 28 });
  assert.equal(result.dailyForecast[0].date, "2024-02-29");
  assert.equal(result.dailyForecast[1].date, "2024-03-01");
  assert.equal(result.dailyForecast.at(-1)!.date, "2024-03-27");
  assert.ok(result.dailyForecast.every((p) => Number.isFinite(p.units)));
  const year = runForecast(series(points(56, () => 4, "2025-11-06")), {
    asOf: "2025-12-31",
    horizonDays: 7,
  });
  assert.equal(year.dailyForecast[0].date, "2026-01-01");
});

test("minimum stock is a floor rather than an additive seasonal multiplier", () => {
  const data = points(56, () => 1);
  const settings = { asOf: data.at(-1)!.date, horizonDays: 7 };
  const floor = runForecast(series(data), { ...settings, minUnits: 20 });
  assert.equal(floor.totalUnits, 20);
  assert.equal(
    floor.dailyForecast.reduce((sum, p) => sum + p.units, 0),
    7,
  );
  const demandLarger = runForecast(series(points(56, () => 10)), {
    ...settings,
    minUnits: 20,
  });
  assert.equal(demandLarger.totalUnits, 70);
});

test("same observations in any input order are deterministic; source, metric and revisions have distinct identity", () => {
  const data = points(720, (i) => 20 + 15 * Math.sin((2 * Math.PI * i) / 365));
  const original = forecast(data, 28);
  const shuffled = forecast(
    [...data].reverse().sort((a, b) => a.date.localeCompare(b.date)),
    28,
  );
  assert.deepEqual(shuffled, original);
  const options = { asOf: data.at(-1)!.date, horizonDays: 28 };
  assert.deepEqual(runForecast(series([...data].reverse()), options), original);
  assert.equal(original.fingerprint.length, 64);
  for (const change of [
    { storeId: "shop-2" },
    { provider: "wildberries" },
    { metric: "financial_sold" },
  ]) {
    const result = runForecast({ ...series(data), ...change }, options);
    assert.notEqual(result.fingerprint, original.fingerprint);
  }
  const corrected = data.map((p) => ({ ...p }));
  corrected[600].units! += 1;
  assert.notEqual(forecast(corrected, 28).fingerprint, original.fingerprint);
});

test("input is not mutated; invalid dates, quantities, duplicates and options fail explicitly", () => {
  const data = points(56);
  const original = JSON.stringify(data);
  forecast(data, 28);
  assert.equal(JSON.stringify(data), original);
  const options = { asOf: data.at(-1)!.date, horizonDays: 28 };
  for (const horizonDays of [0, 331, 1.5, Number.NaN])
    assert.throws(
      () => runForecast(series(data), { ...options, horizonDays }),
      /horizon/,
    );
  for (const asOf of ["2026-02-30", "26-10-2026", "2026-1-01"])
    assert.throws(
      () => runForecast(series(data), { ...options, asOf }),
      /date/,
    );
  assert.throws(
    () => runForecast(series([...data, data[0]]), options),
    /duplicate/,
  );
  for (const units of [-1, Infinity, Number.NaN])
    assert.throws(
      () => runForecast(series([{ ...data[0], units }]), options),
      /units/,
    );
  assert.throws(
    () => runForecast(series(data), { ...options, minUnits: -1 }),
    /minimum/,
  );
});

test("configured baseline window is used in forecasts, comparison folds and identity", () => {
  const data = points(56, (i) => (i < 28 ? 1 : 10)),
    asOf = data.at(-1)!.date;
  const short = runForecast(series(data), {
    asOf,
    horizonDays: 7,
    baselineHistoryDays: 28,
  });
  const long = runForecast(series(data), {
    asOf,
    horizonDays: 7,
    baselineHistoryDays: 56,
  });
  assert.equal(short.totalUnits, 70);
  assert.equal(long.totalUnits, 38.5);
  assert.notEqual(short.fingerprint, long.fingerprint);
  const annual = points(
    720,
    (i) => 30 + 25 * Math.sin((2 * Math.PI * i) / 365),
  );
  const run = (baselineHistoryDays: number) =>
    runForecast(series(annual), {
      asOf: annual.at(-1)!.date,
      horizonDays: 77,
      baselineHistoryDays,
    });
  assert.notEqual(
    run(28).candidates[0].metrics!.mae,
    run(56).candidates[0].metrics!.mae,
  );
  assert.notEqual(
    run(28).candidates[1].metrics!.baselineImprovement,
    run(56).candidates[1].metrics!.baselineImprovement,
  );
  assert.throws(() => run(0), /baseline window/);
});
