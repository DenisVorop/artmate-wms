import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calibrateFinancialSeasonalBridge,
  projectFinancialSeasonalScenario,
} from "../src/forecasting/forecast-calibration";
import type { ForecastSeries } from "../src/forecasting/engine-types";

const DAY = 86_400_000;
const asOf = "2026-10-26";
function source(direction = 1): ForecastSeries {
  const start = Date.parse("2025-03-01");
  return {
    id: "sold",
    provider: "wildberries",
    storeId: "shop",
    externalId: "card",
    metric: "financial_gross_sold",
    points: Array.from(
      { length: (Date.parse(asOf) - start) / DAY + 1 },
      (_, i) => {
        const stamp = start + i * DAY;
        const date = new Date(stamp);
        const dayOfYear = (stamp - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY;
        const season =
          20 +
          direction * 15 * Math.cos((2 * Math.PI * (dayOfYear - 365)) / 365);
        return {
          date: date.toISOString().slice(0, 10),
          units: season * (date.getUTCFullYear() === 2026 ? 1.4 : 1),
          availability: "unknown" as const,
        };
      },
    ),
  };
}
function orders(financial: ForecastSeries, ratio = 1.2): ForecastSeries {
  return {
    ...financial,
    id: "orders",
    metric: "net_ordered",
    points: financial.points
      .slice(-89)
      .map((p) => ({ ...p, units: p.units! * ratio })),
  };
}
const average = (values: number[]) =>
  values.reduce((n, p) => n + p, 0) / values.length;

test("89 order days can use a separately validated 600-day financial season without claiming a long order backtest", () => {
  const financial = source();
  const result = calibrateFinancialSeasonalBridge(
    orders(financial),
    financial,
    asOf,
    106,
    89,
  );
  assert.equal(
    result.candidate.eligible,
    true,
    result.candidate.reason ?? undefined,
  );
  assert.equal(result.seasonalityKnown, true);
  assert.equal(
    result.scenario,
    true,
    "finance skill does not prove 106-day orders skill",
  );
  assert.equal(result.financialValidation?.horizonDays, 106);
  assert.equal(result.financialValidation?.folds, 3);
  assert.deepEqual(result.bridgeValidation?.horizonDays, [7, 14, 28]);
  assert.equal(result.bridgeValidation?.folds, 9);
  assert.equal(result.bridgeValidation?.observedDays, 56);
  assert.equal(result.dailyForecast.length, 106);
  const november = result.dailyForecast.filter((p) =>
    p.date.startsWith("2026-11"),
  );
  const december = result.dailyForecast.filter((p) =>
    p.date.startsWith("2026-12"),
  );
  assert.ok(
    average(december.map((p) => p.units)) >
      average(november.map((p) => p.units)) * 1.03,
  );
  assert.ok(
    Math.abs(
      result.dailyForecast[30].units / result.dailyForecast[29].units - 1,
    ) < 0.1,
  );
});

test("current order level is learned once, without adding financial demand a second time", () => {
  const financial = source();
  const lower = calibrateFinancialSeasonalBridge(
    orders(financial, 1),
    financial,
    asOf,
    106,
  );
  const higher = calibrateFinancialSeasonalBridge(
    orders(financial, 1.5),
    financial,
    asOf,
    106,
  );
  assert.equal(lower.candidate.eligible, true);
  assert.equal(higher.candidate.eligible, true);
  assert.ok(Math.abs(higher.totalUnits / lower.totalUnits - 1.5) < 0.00001);
});

test("the learned financial curve may decline toward December when historical evidence declines", () => {
  const financial = source(-1);
  const result = calibrateFinancialSeasonalBridge(
    orders(financial),
    financial,
    asOf,
    106,
  );
  assert.equal(
    result.candidate.eligible,
    true,
    result.candidate.reason ?? undefined,
  );
  const november = result.dailyForecast.filter((p) =>
    p.date.startsWith("2026-11"),
  );
  const december = result.dailyForecast.filter((p) =>
    p.date.startsWith("2026-12"),
  );
  assert.ok(
    average(december.map((p) => p.units)) <
      average(november.map((p) => p.units)) * 0.8,
  );
});

test("future facts cannot affect a dated bridge, while unknown/stockout facts do not become zero observations", () => {
  const financial = source();
  const operational = orders(financial);
  const before = calibrateFinancialSeasonalBridge(
    operational,
    financial,
    asOf,
    106,
  );
  const future = {
    date: "2026-10-27",
    units: 1_000_000,
    availability: "unknown" as const,
  };
  financial.points.push(future);
  operational.points.push(future);
  assert.deepEqual(
    calibrateFinancialSeasonalBridge(operational, financial, asOf, 106),
    before,
  );
  const sparse = {
    ...operational,
    points: operational.points.map((p, i) => ({
      ...p,
      units: i % 3 ? null : p.units,
    })),
  };
  const rejected = calibrateFinancialSeasonalBridge(
    sparse,
    financial,
    asOf,
    106,
  );
  assert.equal(rejected.candidate.eligible, false);
  assert.equal(rejected.dailyForecast.length, 0);
});

test("unstable conversion, missing prior-year coverage and different store/product/metric cannot borrow finance eligibility", () => {
  const financial = source();
  const operational = orders(financial);
  operational.points = operational.points.map((p, i) => ({
    ...p,
    units: i < 47 ? 1 : 200,
  }));
  const unstable = calibrateFinancialSeasonalBridge(
    operational,
    financial,
    asOf,
    106,
  );
  assert.equal(unstable.candidate.eligible, false);
  const missing = {
    ...financial,
    points: financial.points.map((p, i) => ({
      ...p,
      availability: i % 2 ? ("out_of_stock" as const) : ("unknown" as const),
    })),
  };
  assert.equal(
    calibrateFinancialSeasonalBridge(orders(financial), missing, asOf, 106)
      .candidate.eligible,
    false,
  );
  assert.throws(
    () =>
      calibrateFinancialSeasonalBridge(
        { ...operational, storeId: "other" },
        financial,
        asOf,
        106,
      ),
    /same store/,
  );
  assert.throws(
    () =>
      calibrateFinancialSeasonalBridge(
        { ...operational, externalId: "other" },
        financial,
        asOf,
        106,
      ),
    /same store/,
  );
  assert.throws(
    () =>
      calibrateFinancialSeasonalBridge(
        { ...operational, metric: "returned" },
        financial,
        asOf,
        106,
      ),
    /metrics/,
  );
});

function preliminaryShape(direction = 1) {
  return Array.from({ length: 60 }, (_, i) => ({
    date: new Date(Date.parse(asOf) + (i + 1) * DAY).toISOString().slice(0, 10),
    units: direction > 0 ? 20 + i / 2 : 50 - i / 2,
  }));
}

test("a declared seasonal scenario can use a stable conversion without claiming annual ML validation", () => {
  const financial = { ...source(), points: source().points.slice(-89) };
  const shape = preliminaryShape();
  const result = projectFinancialSeasonalScenario(
    orders(financial, 1.5),
    financial,
    shape,
    asOf,
  );
  assert.equal(
    result.candidate.eligible,
    true,
    result.candidate.reason ?? undefined,
  );
  assert.equal(result.scenario, true);
  assert.equal(result.seasonalityKnown, false);
  assert.equal(result.financialValidation, undefined);
  assert.deepEqual(result.bridgeValidation?.horizonDays, [7, 14, 28]);
  assert.equal(result.dailyForecast[0].units, shape[0].units * 1.5);
  assert.equal(result.dailyForecast.at(-1)?.units, shape.at(-1)!.units * 1.5);
  assert.match(
    result.message!,
    /долгосрочная точность заказов ещё не подтверждена/,
  );
  const declining = projectFinancialSeasonalScenario(
    orders(financial, 1.5),
    financial,
    preliminaryShape(-1),
    asOf,
  );
  assert.equal(declining.candidate.eligible, true);
  assert.ok(
    declining.dailyForecast.at(-1)!.units < declining.dailyForecast[0].units,
  );
});

test("scenario conversion rejects absent, nonpositive and unstable paired observations", () => {
  const financial = source();
  const op = orders(financial);
  const shape = preliminaryShape();
  for (const replacement of [null, 0]) {
    const missing = {
      ...financial,
      points: financial.points.map((p) => ({ ...p, units: replacement })),
    };
    const result = projectFinancialSeasonalScenario(op, missing, shape, asOf);
    assert.equal(result.candidate.eligible, false);
    assert.deepEqual(result.dailyForecast, []);
  }
  const emptyOrders = {
    ...op,
    points: op.points.map((p) => ({ ...p, units: 0 })),
  };
  assert.equal(
    projectFinancialSeasonalScenario(emptyOrders, financial, shape, asOf)
      .candidate.eligible,
    false,
  );
  const unstable = {
    ...op,
    points: op.points.map((p, i) => ({
      ...p,
      units: p.units! * (i < 61 ? 0.3 : 2.5),
    })),
  };
  const rejected = projectFinancialSeasonalScenario(
    unstable,
    financial,
    shape,
    asOf,
  );
  assert.equal(rejected.candidate.eligible, false);
  assert.match(rejected.candidate.reason!, /неустойчива/);
});

test("scenario conversion preserves exact scope, valid chronology and prefix-only identity", () => {
  const financial = source();
  const op = orders(financial);
  const shape = preliminaryShape();
  const before = projectFinancialSeasonalScenario(op, financial, shape, asOf);
  for (const key of ["provider", "storeId", "externalId"] as const)
    assert.throws(
      () =>
        projectFinancialSeasonalScenario(
          { ...op, [key]: "another" },
          financial,
          shape,
          asOf,
        ),
      /same store/,
    );
  assert.throws(
    () =>
      projectFinancialSeasonalScenario(
        { ...op, metric: "returned" },
        financial,
        shape,
        asOf,
      ),
    /metrics/,
  );
  const future = {
    date: "2026-10-27",
    units: 1_000_000,
    availability: "unknown" as const,
  };
  financial.points.push(future);
  op.points.push(future);
  assert.deepEqual(
    projectFinancialSeasonalScenario(op, financial, shape, asOf),
    before,
  );
  assert.throws(
    () =>
      projectFinancialSeasonalScenario(
        op,
        financial,
        [{ ...shape[0], units: -1 }],
        asOf,
      ),
    /nonnegative/,
  );
  assert.throws(
    () => projectFinancialSeasonalScenario(op, financial, shape.slice(1), asOf),
    /consecutive future/,
  );
  assert.throws(
    () =>
      projectFinancialSeasonalScenario(
        { ...op, points: [{ ...op.points[0], units: -1 }] },
        financial,
        shape,
        asOf,
      ),
    /nonnegative/,
  );
});
