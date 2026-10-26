import { test } from "node:test";
import assert from "node:assert/strict";
import { calibrateFinancialSeason } from "../src/forecasting/forecast-calibration";
import type { ForecastSeries } from "../src/forecasting/engine-types";
const asOf = "2025-12-19";
function source(): ForecastSeries {
  return {
    id: "financial",
    provider: "wildberries",
    storeId: "shop-1",
    externalId: "one",
    metric: "net_financial_sold",
    points: Array.from({ length: 719 }, (_, i) => ({
      date: new Date(Date.parse("2024-01-01") + i * 86400000)
        .toISOString()
        .slice(0, 10),
      units: 30 + 25 * Math.sin((2 * Math.PI * i) / 365),
      availability: "unknown",
    })),
  };
}
function orders(financial: ForecastSeries, length: number): ForecastSeries {
  return {
    ...financial,
    id: "operational",
    metric: "net_ordered",
    points: financial.points
      .slice(-length)
      .map((p) => ({ ...p, units: p.units! * 1.2 })),
  };
}
test("cross-metric calibration requires actual operational rolling-origin evidence, not model agreement", () => {
  const financial = source(),
    operational = orders(financial, 89);
  const result = calibrateFinancialSeason(operational, financial, asOf, 77);
  assert.equal(result.candidate.eligible, false);
  assert.match(result.candidate.reason!, /трёх проверок/);
  assert.ok(
    result.candidate.folds >= 3,
    "good short-term fit cannot authorize an untested 77-day calibration",
  );
});
test("known financial season can calibrate an operational series shorter than one year after full holdouts", () => {
  const financial = source(),
    operational = orders(financial, 300);
  const result = calibrateFinancialSeason(operational, financial, asOf, 77);
  assert.equal(result.candidate.eligible, true);
  assert.equal(result.candidate.reason, null);
  assert.equal(result.candidate.folds, 9);
  assert.ok(result.candidate.wape! < 0.02);
  assert.ok(result.totalUnits > 3_000 && result.totalUnits < 4_500);
  assert.ok(
    result.dailyForecast.every((p) => p.units >= 0 && Number.isFinite(p.units)),
  );
});
test("sparse financial event dates and unknown returns do not masquerade as a complete seasonal curve", () => {
  const financial = source(),
    operational = orders(financial, 300);
  financial.points = financial.points.map((p, i) => ({
    ...p,
    units: i % 2 ? p.units : null,
  }));
  const result = calibrateFinancialSeason(operational, financial, asOf, 77);
  assert.equal(result.candidate.eligible, false);
  assert.match(result.candidate.reason!, /полного года/);
});
test("constant or mismatched order patterns do not earn seasonal eligibility just from financial shape", () => {
  const financial = source(),
    operational = orders(financial, 300);
  operational.points = operational.points.map((p) => ({ ...p, units: 10 }));
  const result = calibrateFinancialSeason(operational, financial, asOf, 77);
  assert.equal(result.candidate.eligible, false);
  assert.match(result.candidate.reason!, /не улучшила/);
});
test("future financial or order data cannot leak into calibration or its fingerprint", () => {
  const financial = source(),
    operational = orders(financial, 300);
  const base = calibrateFinancialSeason(operational, financial, asOf, 77);
  const future = {
    date: "2025-12-20",
    units: 1_000_000,
    availability: "unknown" as const,
  };
  financial.points.push(future);
  operational.points.push(future);
  assert.deepEqual(
    calibrateFinancialSeason(operational, financial, asOf, 77),
    base,
  );
  assert.throws(
    () =>
      calibrateFinancialSeason(
        { ...operational, storeId: "other" },
        financial,
        asOf,
        77,
      ),
    /same store/,
  );
});
test("zero financial demand cannot cause a division error or invent a cross-metric growth ratio", () => {
  const financial = source(),
    operational = orders(financial, 300);
  financial.points = financial.points.map((p) => ({ ...p, units: 0 }));
  const result = calibrateFinancialSeason(operational, financial, asOf, 77);
  assert.equal(result.candidate.eligible, false);
  assert.equal(result.totalUnits, 0);
  assert.match(result.candidate.reason!, /ненулевого/);
});
