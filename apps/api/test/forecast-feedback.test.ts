import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildForecastFeedback,
  forecastFeedbackBucket,
  forecastFeedbackFactor,
} from "../src/forecasting/journal-feedback";
import type {
  ForecastJournalRun,
  ForecastJournalSeries,
} from "../src/forecasting/journal-types";
import type { ForecastHistorySeries } from "../src/forecasting/history-types";
import {
  computeForecast,
  forecastPlanModelIdentity,
  type ForecastComputeInput,
} from "../src/forecasting/forecast-projection";
import { forecastJournalScopes } from "../src/forecasting/journal-types";
import { FORECAST_MODEL_VERSION } from "../src/forecasting/engine";
import { seedWorkspace } from "../src/seed";
import { defaultSettings } from "../src/marketplaces/storage";

const day = (index: number) =>
  new Date(Date.parse("2025-01-01") + index * 86_400_000)
    .toISOString()
    .slice(0, 10);
function fixture(
  count = 60,
  actual: (index: number) => number = () => 15,
  lead = 1,
) {
  const scope = {
    scopeKey: "scope",
    skuId: "sku",
    skuName: "Котики",
    provider: "ozon" as const,
    storeId: "shop",
    mappings: [{ externalId: "card", unitsPerItem: 1 }],
    unitsPerBox: 20,
  };
  const series: ForecastJournalSeries = {
    ...scope,
    id: "series",
    metric: "net_ordered",
    modelLabel: "Модель",
    modelIdentity: "model-identity",
    scenario: false,
    points: [],
  };
  const runs: ForecastJournalRun[] = Array.from(
    { length: count },
    (_, index) => ({
      id: `run-${index}`,
      generatedAt: `${day(index - lead)}T09:00:00.000Z`,
      publishedAt: `${day(index - lead)}T09:00:01.000Z`,
      asOf: day(index - lead - 1),
      modelVersion: FORECAST_MODEL_VERSION,
      observedActuals: Array.from(
        { length: Math.max(0, index - lead) },
        (_, prior) => ({
          scopeKey: scope.scopeKey,
          date: day(prior),
          units: actual(prior),
          stockout: false,
        }),
      ),
      settings: {
        historyDays: 89,
        horizonDays: 56,
        safetyDays: 14,
        leadDays: 7,
        dispatchWeekday: 6,
      },
      series: [
        {
          ...series,
          points: [
            { date: day(index), baseUnits: 10, units: 12.5, factor: 1.25 },
          ],
        },
      ],
    }),
  );
  const ordered: ForecastHistorySeries = {
    skuId: scope.skuId,
    provider: scope.provider,
    storeId: scope.storeId,
    externalId: "card",
    metric: "ordered",
    source: "ozon_fbo",
    points: Array.from({ length: count }, (_, index) => ({
      date: day(index),
      units: actual(index),
      availability: "available" as const,
    })),
  };
  const history: ForecastHistorySeries[] = [
    ordered,
    {
      ...ordered,
      metric: "cancelled",
      points: ordered.points.map((point) => ({ ...point, units: 0 })),
    },
  ];
  return { scope, series, runs, history };
}

test("prospective bias correction validates on three sequential weeks and stays bounded", () => {
  const { runs, history } = fixture();
  const [report] = buildForecastFeedback(
    runs,
    history,
    day(60),
    FORECAST_MODEL_VERSION,
  );
  assert.equal(report.status, "active");
  assert.equal(report.observedDays, 60);
  assert.equal(report.validatedFolds, 3);
  assert.equal(report.winningFolds, 3);
  assert.equal(report.factor, 1.25);
  assert.equal(report.improvement, 0.5);
  const low = fixture(60, () => 5);
  assert.equal(
    buildForecastFeedback(
      low.runs,
      low.history,
      day(60),
      FORECAST_MODEL_VERSION,
    )[0].factor,
    0.75,
  );
});

test("frequent snapshots have one vote per target date and do not compound prior corrections", () => {
  const { runs, history } = fixture();
  const baseline = buildForecastFeedback(
    runs,
    history,
    day(60),
    FORECAST_MODEL_VERSION,
  );
  const duplicates = runs.flatMap((run) =>
    Array.from({ length: 48 }, (_, index) => ({
      ...run,
      id: `${run.id}/${index}`,
      publishedAt: run.publishedAt.replace(
        "09:00",
        `09:${String(index).padStart(2, "0")}`,
      ),
      series: run.series.map((series) => ({
        ...series,
        points: series.points.map((point) => ({
          ...point,
          units: 9999,
          factor: 999.9,
        })),
      })),
    })),
  );
  assert.deepEqual(
    buildForecastFeedback(duplicates, history, day(60), FORECAST_MODEL_VERSION),
    baseline,
  );
});

test("unknown, censored, same-day and future facts never become calibration observations", () => {
  const { runs, history } = fixture();
  history[0].points[0].units = null;
  history[0].points[1].availability = "out_of_stock";
  runs[2].publishedAt = `${day(2)}T09:00:00Z`;
  const [report] = buildForecastFeedback(
    runs,
    history,
    day(32),
    FORECAST_MODEL_VERSION,
  );
  assert.equal(report.observedDays, 30);
  assert.equal(report.status, "waiting");
  history[0].points[55].units = 1000000;
  assert.deepEqual(
    buildForecastFeedback(runs, history, day(32), FORECAST_MODEL_VERSION),
    [report],
  );
});

test("scope, model identity, launch scenarios and operational metric are isolated", () => {
  const { runs, history } = fixture();
  assert.deepEqual(
    buildForecastFeedback(runs, history, day(60), "new-version"),
    [],
  );
  assert.deepEqual(
    buildForecastFeedback(runs, history, day(60), FORECAST_MODEL_VERSION, [
      "other-shop",
    ]),
    [],
  );
  assert.deepEqual(
    buildForecastFeedback(
      runs.map((run) => ({
        ...run,
        series: run.series.map((series) => ({ ...series, scenario: true })),
      })),
      history,
      day(60),
      FORECAST_MODEL_VERSION,
    ),
    [],
  );
  const changed = runs.map((run, index) =>
    index < 30
      ? run
      : {
          ...run,
          series: run.series.map((series) => ({
            ...series,
            modelLabel: "Другая модель",
            modelIdentity: "different-selected-algorithm",
          })),
        },
  );
  assert.ok(
    buildForecastFeedback(
      changed,
      history,
      day(60),
      FORECAST_MODEL_VERSION,
    ).every((report) => report.status === "waiting"),
  );
  const renamed = runs.map((run) => ({
    ...run,
    series: run.series.map((series) => ({
      ...series,
      modelLabel: "Новая подпись той же модели",
    })),
  }));
  assert.equal(
    buildForecastFeedback(renamed, history, day(60), FORECAST_MODEL_VERSION)[0]
      .status,
    "active",
  );
});

test("no error and an ineffective held-out correction remain disabled", () => {
  const perfect = fixture(60, () => 10);
  const [good] = buildForecastFeedback(
    perfect.runs,
    perfect.history,
    day(60),
    FORECAST_MODEL_VERSION,
  );
  assert.equal(good.status, "no_improvement");
  assert.equal(good.factor, 1);
  const shift = fixture(60, (index) => (index < 39 ? 15 : 5));
  const [bad] = buildForecastFeedback(
    shift.runs,
    shift.history,
    day(60),
    FORECAST_MODEL_VERSION,
  );
  assert.equal(bad.status, "no_improvement");
  assert.equal(bad.factor, 1);
});

test("long lead bucket requires facts available before each held-out publication", () => {
  const { runs, history } = fixture(35, () => 15, 30);
  const [report] = buildForecastFeedback(
    runs,
    history,
    day(35),
    FORECAST_MODEL_VERSION,
  );
  assert.equal(report.observedDays, 35);
  assert.equal(report.status, "waiting");
  assert.equal(report.validatedFolds, 0);
  const mature = fixture(90, () => 15, 30);
  const [enabled] = buildForecastFeedback(
    mature.runs,
    mature.history,
    day(90),
    FORECAST_MODEL_VERSION,
  );
  assert.equal(enabled.status, "active");
  assert.equal(enabled.bucket, "8-30");
});

test("missing recent calendar days and very low volume cannot validate a multiplier", () => {
  const { runs, history } = fixture();
  history[0].points[50].units = null;
  assert.equal(
    buildForecastFeedback(runs, history, day(60), FORECAST_MODEL_VERSION)[0]
      .status,
    "waiting",
  );
  const small = fixture(60, () => 0.01);
  assert.equal(
    buildForecastFeedback(
      small.runs,
      small.history,
      day(60),
      FORECAST_MODEL_VERSION,
    )[0].status,
    "insufficient_volume",
  );
});

test("late backfill and revised facts cannot leak into historical correction training", () => {
  const { runs, history } = fixture();
  const withoutProof: ForecastJournalRun[] = runs.map((run) => ({
    ...run,
    observedActuals: [],
  }));
  assert.equal(
    buildForecastFeedback(
      withoutProof,
      history,
      day(60),
      FORECAST_MODEL_VERSION,
    )[0].status,
    "waiting",
  );
  // Date alone is insufficient: these quantities were only seen after every held-out issue.
  withoutProof.push({
    ...runs.at(-1)!,
    id: "late-facts",
    publishedAt: `${day(60)}T09:00:00Z`,
    asOf: day(59),
    observedActuals: history[0].points.map((point) => ({
      scopeKey: "scope",
      date: point.date,
      units: point.units!,
      stockout: false,
    })),
  });
  assert.equal(
    buildForecastFeedback(
      withoutProof,
      history,
      day(60),
      FORECAST_MODEL_VERSION,
    )[0].status,
    "waiting",
  );
  history[0].points = history[0].points.map((point) => ({
    ...point,
    units: 17,
  }));
  // Original issue-time snapshots contain 15, so revised 17 cannot be presented as old knowledge.
  assert.equal(
    buildForecastFeedback(runs, history, day(60), FORECAST_MODEL_VERSION)[0]
      .status,
    "waiting",
  );
  const revised = fixture();
  for (let index = 20; index < revised.runs.length; index++)
    revised.runs[index].observedActuals = revised.runs[
      index
    ].observedActuals!.map((point) => ({ ...point, units: 17 }));
  // An ancient matching value cannot override a newer, different snapshot known at issue time.
  assert.equal(
    buildForecastFeedback(
      revised.runs,
      revised.history,
      day(60),
      FORECAST_MODEL_VERSION,
    )[0].status,
    "waiting",
  );
});

test("lead buckets exclude issue day and unsupported horizons", () => {
  assert.deepEqual([0, 1, 7, 8, 30, 31].map(forecastFeedbackBucket), [
    null,
    "1-7",
    "1-7",
    "8-30",
    "8-30",
    null,
  ]);
  const { runs, history } = fixture();
  const reports = buildForecastFeedback(
    runs,
    history,
    day(60),
    FORECAST_MODEL_VERSION,
  );
  assert.equal(
    forecastFeedbackFactor(reports, day(61), `${day(60)}T09:00:00Z`),
    1.25,
  );
  assert.equal(
    forecastFeedbackFactor(reports, day(60), `${day(60)}T09:00:00Z`),
    1,
  );
  assert.equal(
    forecastFeedbackFactor(reports, day(90), `${day(60)}T09:00:00Z`),
    1,
  );
});

test("worker projection keeps immutable bases and adjusts operational goals and charts together", () => {
  const { runs, history } = fixture();
  const sku = { ...seedWorkspace().skus[0], id: "sku", name: "Котики" };
  const input: ForecastComputeInput = {
    key: "projection",
    asOf: day(59),
    generatedAt: `${day(60)}T09:00:00Z`,
    skus: [sku],
    policies: [{ skuId: sku.id, minimumBoxes: 0, seasonalityEnabled: true }],
    settings: { ...defaultSettings, historyDays: 56, horizonDays: 56 },
    mappings: [
      { provider: "ozon", externalId: "card", skuId: sku.id, unitsPerItem: 1 },
    ],
    connections: [{ provider: "ozon", storeId: "shop" }],
    snapshots: [],
    series: [
      ...history,
      {
        ...history[0],
        metric: "sold",
        points: history[0].points.map((point) => ({ ...point, units: 7 })),
      },
      {
        ...history[0],
        metric: "returned",
        points: history[0].points.map((point) => ({ ...point, units: 1 })),
      },
    ],
  };
  const base = computeForecast(input);
  const selection = {
    kind: "operational",
    monthly: "ridge",
    tail: "mean",
    scenario: false,
  };
  const identity = forecastPlanModelIdentity(
    input,
    input.mappings[0],
    input.policies[0],
    selection,
  );
  assert.notEqual(
    identity,
    forecastPlanModelIdentity(input, input.mappings[0], input.policies[0], {
      ...selection,
      monthly: "autoregressive",
    }),
  );
  assert.notEqual(
    identity,
    forecastPlanModelIdentity(input, input.mappings[0], input.policies[0], {
      ...selection,
      monthly: "financial_calendar_ml",
    }),
  );
  assert.notEqual(
    identity,
    forecastPlanModelIdentity(
      { ...input, settings: { ...input.settings, historyDays: 89 } },
      input.mappings[0],
      input.policies[0],
      selection,
    ),
  );
  assert.notEqual(
    identity,
    forecastPlanModelIdentity(
      input,
      input.mappings[0],
      { ...input.policies[0], seasonalityEnabled: false },
      selection,
    ),
  );
  assert.notEqual(
    identity,
    forecastPlanModelIdentity(
      input,
      { ...input.mappings[0], unitsPerItem: 2 },
      input.policies[0],
      selection,
    ),
  );
  const label = base.goals[sku.id].sources![0].methodLabel;
  const scope = forecastJournalScopes(input)[0];
  input.journalRuns = runs.map((run) => ({
    ...run,
    observedActuals: run.observedActuals?.map((point) => ({
      ...point,
      scopeKey: scope.scopeKey,
    })),
    series: run.series.map((series) => ({
      ...series,
      ...scope,
      modelLabel: label,
      modelIdentity: base.goals[sku.id].sources![0].modelIdentity!,
    })),
  }));
  const corrected = computeForecast(input);
  const source = corrected.goals[sku.id].sources![0];
  const baseSource = base.goals[sku.id].sources![0];
  assert.deepEqual(source.journalBaseForecast, baseSource.dailyForecast);
  const factor = new Map(
    source.dailyForecast.map((point, index) => [
      point.date,
      point.units / baseSource.dailyForecast[index].units,
    ]),
  );
  assert.equal(factor.get(day(61)), 1.25);
  assert.equal(factor.get(day(68)), 1);
  const row = corrected.overview.rows[0];
  const chart = row.sources.find(
    (item) => item.metricLabel === "Заказы за вычетом отмен",
  )!;
  assert.deepEqual(
    chart.points
      .filter((point) => point.predicted !== null)
      .map((point) => ({ date: point.date, units: point.predicted })),
    source.dailyForecast,
  );
  assert.equal(
    chart.predictedUnits,
    source.dailyForecast.reduce((sum, point) => sum + point.units, 0),
  );
  assert.equal(row.targetUnits, corrected.goals[sku.id].targetUnits);
  assert.ok(
    corrected.journalFeedback!.some((report) => report.status === "active"),
  );
  assert.ok(row.targetUnits > base.overview.rows[0].targetUnits);
  assert.deepEqual(
    row.sources.filter(
      (item) => item.metricLabel !== "Заказы за вычетом отмен",
    ),
    base.overview.rows[0].sources.filter(
      (item) => item.metricLabel !== "Заказы за вычетом отмен",
    ),
  );
  input.policies[0].minimumBoxes = 1000;
  assert.equal(
    computeForecast(input).goals[sku.id].targetUnits,
    1000 * sku.unitsPerBox,
  );
  const multiple: ForecastComputeInput = {
    ...input,
    journalRuns: [],
    mappings: [
      ...input.mappings,
      { ...input.mappings[0], externalId: "second-card" },
    ],
    series: [
      ...input.series,
      ...input.series.map((series) => ({
        ...series,
        externalId: "second-card",
      })),
    ],
  };
  const firstOrder =
    computeForecast(multiple).goals[sku.id].sources![0].modelIdentity;
  const secondOrder = computeForecast({
    ...multiple,
    mappings: [...multiple.mappings].reverse(),
  }).goals[sku.id].sources![0].modelIdentity;
  assert.equal(firstOrder, secondOrder);
  assert.notEqual(firstOrder, source.modelIdentity);
});
