import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarFeatures,
  knownCalendarFeatures,
} from "../src/forecasting/calendar-features";
import { fitUnvalidatedCalendarForecast } from "../src/forecasting/engine";
import { fitAutoregressive } from "../src/forecasting/engine-autoregressive";
import { calibrateFinancialCalendarMl } from "../src/forecasting/forecast-calibration";
import type { ForecastSeries } from "../src/forecasting/engine-types";
const DAY = 86400000;
const day = (date: string) => Date.parse(date) / DAY;
function financialSeries(): ForecastSeries {
  return {
    id: "financial",
    provider: "wildberries",
    storeId: "store",
    externalId: "theme",
    metric: "financial_gross_sold",
    points: Array.from({ length: 900 }, (_, i) => {
      const stamp = Date.parse("2024-01-01") + i * DAY;
      return {
        date: new Date(stamp).toISOString().slice(0, 10),
        units:
          35 + 20 * Math.sin((2 * Math.PI * i) / 365) + (i % 7 < 5 ? 0 : 10),
        availability: "unknown" as const,
      };
    }),
  };
}
test("calendar covariates encode month, week, fixed holidays and New Year lead-up without invented closures", () => {
  const march = knownCalendarFeatures(day("2026-03-08"));
  assert.equal(march.month_3, 1);
  assert.equal(march.holiday_women, 1);
  assert.equal(march.lead_women_14, 1);
  assert.equal(march.new_year_lead_60, 0);
  assert.ok(Number.isFinite(march.week_of_year_sin));
  const december = knownCalendarFeatures(day("2026-12-20"));
  assert.equal(december.new_year_lead_14, 1);
  assert.equal(december.new_year_lead_30, 1);
  assert.ok(december.new_year_lead_60 > 0.7);
  assert.equal(knownCalendarFeatures(day("2027-01-08")).holiday_new_year, 1);
  assert.equal(knownCalendarFeatures(day("2027-01-09")).holiday_new_year, 0);
  assert.equal(knownCalendarFeatures(day("2026-11-04")).holiday_unity, 1);
  const ordinary = knownCalendarFeatures(day("2026-02-10"));
  assert.deepEqual(Object.keys(ordinary), Object.keys(december));
  assert.ok(
    calendarFeatures(day("2026-02-10"), day("2024-01-01")).every(
      Number.isFinite,
    ),
  );
  assert.throws(() => knownCalendarFeatures(1.5), /integer/);
});
test("calendar training uses observations older than 730 days, never future values", () => {
  const base = financialSeries(),
    asOf = base.points.at(-1)!.date;
  const changed = structuredClone(base);
  for (let i = 0; i < 160; i++) changed.points[i].units! *= 1.6;
  assert.deepEqual(base.points.slice(-730), changed.points.slice(-730));
  const one = fitUnvalidatedCalendarForecast(base, asOf, 30);
  const two = fitUnvalidatedCalendarForecast(changed, asOf, 30);
  assert.equal(one.reason, null);
  assert.ok(
    one.dailyForecast.some(
      (p, i) => Math.abs(p.units - two.dailyForecast[i].units) > 0.01,
    ),
  );
  changed.points.push({
    date: new Date(Date.parse(asOf) + DAY).toISOString().slice(0, 10),
    units: 99999999,
    availability: "unknown",
  });
  assert.deepEqual(fitUnvalidatedCalendarForecast(changed, asOf, 30), two);
});
test("full financial calendar ML requires operational horizon holdouts before conversion to orders", () => {
  const financial = financialSeries(),
    asOf = financial.points.at(-1)!.date;
  const operational: ForecastSeries = {
    ...financial,
    id: "orders",
    metric: "net_ordered",
    points: financial.points
      .slice(-360)
      .map((p) => ({ ...p, units: p.units! * 1.2 })),
  };
  const result = calibrateFinancialCalendarMl(operational, financial, asOf, 30);
  assert.equal(result.candidate.model, "financial_calendar_ml");
  assert.equal(result.candidate.eligible, true);
  assert.ok(result.candidate.folds >= 3);
  assert.ok(result.candidate.wape! < 0.15);
  assert.ok(
    result.dailyForecast.every((p) => p.units >= 0 && Number.isFinite(p.units)),
  );
  const short = { ...operational, points: operational.points.slice(-56) };
  const unproven = calibrateFinancialCalendarMl(short, financial, asOf, 30);
  assert.equal(unproven.candidate.eligible, false);
  assert.match(unproven.candidate.reason!, /трёх проверок/);
  const future = {
    date: new Date(Date.parse(asOf) + DAY).toISOString().slice(0, 10),
    units: 99999999,
    availability: "unknown" as const,
  };
  assert.deepEqual(
    calibrateFinancialCalendarMl(
      { ...operational, points: [...operational.points, future] },
      { ...financial, points: [...financial.points, future] },
      asOf,
      30,
    ),
    result,
  );
});
test("sparse financial reports, unmapped stores and unknown zeros never earn false calendar ML eligibility", () => {
  const financial = financialSeries(),
    asOf = financial.points.at(-1)!.date;
  const operational = { ...financial, metric: "net_ordered" };
  financial.points = financial.points.map((p, i) => ({
    ...p,
    units: i % 2 ? p.units : null,
  }));
  const result = calibrateFinancialCalendarMl(operational, financial, asOf, 30);
  assert.equal(result.candidate.eligible, false);
  assert.match(result.candidate.reason!, /пропусков/);
  assert.throws(
    () =>
      calibrateFinancialCalendarMl(
        { ...operational, storeId: "another" },
        financial,
        asOf,
        30,
      ),
    /same store/,
  );
});

test("short settlement lag is forecast recursively without treating unknown days as observed sales", () => {
  const train = financialSeries().points.map((p) => ({
    day: day(p.date),
    units: p.units!,
  }));
  const lastKnown = train.at(-1)!.day;
  const fromKnown = fitAutoregressive(train, lastKnown, 33, 56);
  const withLag = fitAutoregressive(train, lastKnown + 3, 30, 56);
  assert.ok(fromKnown.values);
  assert.deepEqual(withLag.values, fromKnown.values.slice(3));
  assert.equal(withLag.reason, null);
  assert.equal(withLag.values!.length, 30);
  assert.deepEqual(
    fitAutoregressive(
      [...train, { day: lastKnown + 4, units: 999999 }],
      lastKnown + 3,
      30,
      56,
    ),
    withLag,
  );
  assert.equal(fitAutoregressive(train, lastKnown + 8, 30, 56).values, null);
});
