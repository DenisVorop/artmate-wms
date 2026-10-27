import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedWorkspace } from "../src/seed";
import {
  computeForecast,
  baselineForecastOverview,
  baselineForecastSource,
  type ForecastComputeInput,
} from "../src/forecasting/forecast-projection";
import { computeForecastInWorker } from "../src/forecasting/forecast-worker";
import {
  defaultSettings,
  type MarketplaceState,
} from "../src/marketplaces/storage";
import type { ForecastHistorySeries } from "../src/forecasting/history-types";
import { captureForecastJournal } from "../src/forecasting/journal-types";

test("every displayed chart has stable per-card metric identity and archives its own final forward curve", () => {
  const { input } = fixture();
  input.series = [
    history("ordered", () => 10),
    history("cancelled", () => 1),
    history("sold", () => 7),
    history("returned", () => 2),
  ];
  input.mappings.push({ ...input.mappings[0], externalId: "two" });
  input.series.push(
    ...input.series.map((series) => ({ ...series, externalId: "two" })),
  );
  const cache = computeForecast(input);
  assert.equal(cache.chartIdentities!.length, 6);
  assert.equal(
    new Set(cache.chartIdentities!.map((identity) => identity.historyKey)).size,
    6,
  );
  const run = captureForecastJournal(input, cache, input.generatedAt);
  assert.equal(run.charts!.length, 6);
  for (const identity of cache.chartIdentities!) {
    const source = cache.overview.rows[0].sources[identity.sourceIndex];
    assert.equal(source.forecastFrom, "2025-12-20");
    const archived = run.charts!.find(
      (chart) => chart.historyKey === identity.historyKey,
    )!;
    assert.equal(archived.metric, identity.metric);
    assert.deepEqual(
      archived.points,
      source.points
        .filter((point) => point.predicted !== null)
        .map((point) => ({ date: point.date, units: point.predicted })),
    );
    assert.ok(archived.points.every((point) => point.date > input.asOf));
    assert.equal("sourceIndex" in archived, false);
  }
  const archived = run.charts![0].points[0].units;
  cache.overview.rows[0].sources[0].points.find(
    (point) => point.predicted !== null,
  )!.predicted = 999;
  assert.equal(run.charts![0].points[0].units, archived);
});

const clock = new Date("2025-12-20T12:00:00Z");
function fixture() {
  const w = seedWorkspace(),
    sku = w.skus[0];
  const m: MarketplaceState = {
    connections: [
      {
        provider: "ozon",
        encrypted: "never-send-to-worker",
        clientId: "safeid",
        enabled: true,
        version: 1,
        syncStatus: "success",
        lastAttemptAt: clock.toISOString(),
        lastSuccessAt: clock.toISOString(),
        message: null,
        warnings: [],
        runId: null,
        historyStoreId: "shop-1",
      },
    ],
    snapshots: [
      {
        provider: "ozon",
        asOf: clock.toISOString(),
        from: "2025-10-25",
        to: "2025-12-19",
        products: [{ externalId: "one", name: sku.name, barcodes: [] }],
        stocks: [
          {
            externalId: "one",
            warehouseId: "w",
            warehouseName: "w",
            availableUnits: 0,
            reservedUnits: 0,
            inboundUnits: 0,
          },
        ],
        demand: [
          {
            externalId: "one",
            date: "2025-12-18",
            orderedUnits: 35,
            cancelledUnits: 3,
            soldUnits: 999,
            returnedUnits: 0,
          },
        ],
        coverage: { catalog: true, stocks: true, demand: true, inbound: true },
        warnings: [],
      },
    ],
    mappings: [
      { provider: "ozon", externalId: "one", skuId: sku.id, unitsPerItem: 2 },
    ],
    settings: {
      ...defaultSettings,
      historyDays: 56,
      horizonDays: 56,
      safetyDays: 14,
      leadDays: 7,
    },
    transit: {},
  };
  const input: ForecastComputeInput = {
    key: "input-key",
    asOf: "2025-12-19",
    generatedAt: clock.toISOString(),
    skus: [sku],
    policies: [{ skuId: sku.id, minimumBoxes: 0, seasonalityEnabled: true }],
    settings: m.settings,
    mappings: m.mappings,
    connections: [{ provider: "ozon", storeId: "shop-1" }],
    snapshots: m.snapshots,
    series: [],
  };
  return { w, m, input };
}
function history(
  metric: ForecastHistorySeries["metric"],
  units: (index: number, date: Date) => number,
): ForecastHistorySeries {
  const { input } = fixture();
  return {
    skuId: input.skus[0].id,
    provider: "ozon",
    storeId: "shop-1",
    externalId: "one",
    metric,
    source: "ozon_fbo",
    points: Array.from({ length: 719 }, (_, index) => {
      const date = new Date(Date.parse("2024-01-01") + index * 86400000);
      return {
        date: date.toISOString().slice(0, 10),
        units: units(index, date),
        availability: "unknown",
      };
    }),
  };
}
test("new product fallback uses known days since observation and the same daily baseline as planning", () => {
  const { input } = fixture();
  const data = history("ordered", () => 10).points.slice(-14);
  input.series = [
    {
      ...history("ordered", () => 999),
      points: data,
    },
    {
      ...history("cancelled", () => 0),
      points: data.map((p) => ({ ...p, units: 0 })),
    },
  ];
  const result = computeForecast(input),
    baseline = baselineForecastSource(input, "ozon", "one", 106);
  assert.equal(result.goals[input.skus[0].id].targetUnits, 1060);
  assert.deepEqual(
    result.goals[input.skus[0].id].sources![0].dailyForecast,
    baseline.dailyForecast,
  );
  assert.equal(result.overview.rows[0].seasonalityApplied, false);
  assert.equal(result.overview.rows[0].sources[0].predictedUnits, 1060);
  assert.match(
    result.overview.rows[0].sources[0].candidates.find(
      (c) => c.model === "mean",
    )!.reason!,
    /Базовая оценка/,
  );
  assert.doesNotMatch(
    result.overview.rows[0].sources[0].candidates.find(
      (c) => c.model === "mean",
    )!.reason!,
    /Проверено/,
  );
  assert.equal(
    result.overview.rows[0].sources[0].points.filter(
      (p) => p.predicted !== null,
    )[0].predicted,
    10,
  );
});
test("a validated annual net-order model replaces only its own mapped source contribution", () => {
  const { input } = fixture();
  input.series = [
    history("ordered", (_, date) => (date.getUTCMonth() >= 10 ? 50 : 5)),
    history("cancelled", () => 0),
  ];
  const result = computeForecast(input),
    row = result.overview.rows[0];
  assert.equal(row.seasonalityApplied, true);
  assert.ok(row.targetUnits > 300 && row.targetUnits < 1_100);
  assert.equal(row.knownDays, 719);
  assert.equal(row.sources[0].metricLabel, "Заказы за вычетом отмен");
  assert.ok(
    row.sources[0].candidates.some((c) => c.eligible && c.model !== "mean"),
  );
  assert.equal(row.confidenceLabel, "Умеренная уверенность");
});
test("financial sales and returns are diagnostic, never silently added to operational demand", () => {
  const { input } = fixture();
  const baseline = computeForecast(input);
  input.series = [
    history("sold", () => 1_000_000),
    history("returned", () => 50_000),
  ];
  const result = computeForecast(input);
  assert.equal(
    result.goals[input.skus[0].id].targetUnits,
    baseline.goals[input.skus[0].id].targetUnits,
  );
  assert.equal(result.overview.rows[0].seasonalityApplied, false);
  assert.equal(result.overview.rows[0].sources.length, 2);
  assert.match(
    result.overview.rows[0].sources[0].metricLabel,
    /отдельно от заказов/,
  );
});
test("old account or disabled provider history cannot inform an active account forecast", () => {
  const { input } = fixture();
  const base = computeForecast(input);
  input.series = [
    { ...history("ordered", () => 50_000), storeId: "previous-shop" },
    { ...history("cancelled", () => 0), storeId: "previous-shop" },
    { ...history("sold", () => 50_000), provider: "wildberries" },
  ];
  const result = computeForecast(input);
  assert.deepEqual(result.overview, base.overview);
  assert.deepEqual(result.fingerprints, []);
});
test("seasonality switch uses the adaptive fallback; minimum boxes is a floor", () => {
  const { input } = fixture();
  input.series = [
    history("ordered", (_, date) => (date.getUTCMonth() >= 10 ? 50 : 5)),
    history("cancelled", () => 0),
  ];
  input.policies[0].seasonalityEnabled = false;
  input.policies[0].minimumBoxes = 3;
  const result = computeForecast(input),
    row = result.overview.rows[0];
  assert.equal(row.seasonalityApplied, false);
  assert.equal(
    row.targetUnits,
    Math.max(
      Math.ceil(
        baselineForecastSource(input, "ozon", "one", 106).dailyForecast.reduce(
          (n, p) => n + p.units,
          0,
        ),
      ),
      3 * input.skus[0].unitsPerBox,
    ),
  );
  input.policies[0].minimumBoxes = 100;
  assert.equal(
    computeForecast(input).overview.rows[0].targetUnits,
    Math.max(
      Math.ceil(
        baselineForecastSource(input, "ozon", "one", 106).dailyForecast.reduce(
          (n, p) => n + p.units,
          0,
        ),
      ),
      100 * input.skus[0].unitsPerBox,
    ),
  );
  assert.equal(
    baselineForecastOverview(input).rows[0].targetUnits,
    Math.max(
      Math.ceil(
        baselineForecastSource(input, "ozon", "one", 106).dailyForecast.reduce(
          (n, p) => n + p.units,
          0,
        ),
      ),
      100 * input.skus[0].unitsPerBox,
    ),
  );
});
test("real isolated worker computes the same result and shutdown cannot publish a late result", async () => {
  const { input } = fixture();
  input.series = [
    history("ordered", (_, date) => (date.getUTCMonth() >= 10 ? 50 : 5)),
    history("cancelled", () => 0),
  ];
  assert.deepEqual(
    await computeForecastInWorker(input),
    computeForecast(input),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    computeForecastInWorker(input, controller.signal),
    /stopped/,
  );
});

test("gross financial sales with no returns are a separate calibrated seasonal feature, not fake net financial quantities", () => {
  const { input } = fixture();
  const sold = history(
    "sold",
    (i) => 30 + 25 * Math.sin((2 * Math.PI * i) / 365),
  );
  const ordered = {
    ...history("ordered", () => 0),
    points: sold.points
      .slice(-380)
      .map((p) => ({ ...p, units: p.units! * 1.2 })),
  };
  const cancelled = {
    ...history("cancelled", () => 0),
    points: ordered.points.map((p) => ({ ...p, units: 0 })),
  };
  input.series = [sold, ordered, cancelled];
  const result = computeForecast(input),
    row = result.overview.rows[0],
    source = row.sources.find(
      (s) => s.metricLabel === "Заказы за вычетом отмен",
    )!;
  assert.equal(row.seasonalityApplied, true);
  assert.match(source.modelLabel, /ML: ближайшие 30 дней/);
  assert.equal(
    source.candidates.find((c) => c.model === "financial_calendar_ml_monthly")!
      .eligible,
    true,
  );
  assert.equal(
    source.candidates.find((c) => c.model === "financial_calibrated")!.eligible,
    true,
  );
  assert.equal(
    row.sources.some((s) => s.metricLabel.includes("Возвраты")),
    false,
  );
  input.series = [
    sold,
    { ...ordered, points: ordered.points.slice(-89) },
    { ...cancelled, points: cancelled.points.slice(-89) },
  ];
  const early = computeForecast(input).overview.rows[0];
  assert.equal(early.seasonalityApplied, false);
  assert.match(
    early.sources[0].candidates.find((c) => c.model === "financial_calibrated")!
      .reason!,
    /трёх проверок/,
  );
});

test("cached goals preserve daily provider curves and aggregate cards without inflating them by minimum stock", () => {
  const { input } = fixture();
  input.series = [
    {
      ...history("ordered", () => 10),
      points: history("ordered", () => 10).points.slice(-14),
    },
    {
      ...history("cancelled", () => 0),
      points: history("cancelled", () => 0).points.slice(-14),
    },
  ];
  input.mappings.push({ ...input.mappings[0], externalId: "two" });
  input.series.push(...input.series.map((s) => ({ ...s, externalId: "two" })));
  input.policies[0].minimumBoxes = 1000;
  const result = computeForecast(input),
    goal = result.goals[input.skus[0].id];
  assert.equal(goal.sources!.length, 1);
  assert.equal(goal.sources![0].provider, "ozon");
  assert.equal(goal.sources![0].dailyForecast.length, 106);
  assert.equal(goal.sources![0].dailyForecast[0].date, "2025-12-20");
  assert.equal(goal.sources![0].dailyForecast[0].units, 20);
  assert.equal(goal.targetUnits, 1000 * input.skus[0].unitsPerBox);
  assert.equal(
    goal.sources![0].dailyForecast.reduce((n, p) => n + p.units, 0),
    2120,
  );
});

test("a validated short-term trained model reaches the plan without being labeled annual seasonality", () => {
  const { input } = fixture();
  input.series = [
    history("ordered", (i) => (i % 7 < 5 ? 10 : 40)),
    history("cancelled", () => 0),
  ].map((s) => ({ ...s, points: s.points.slice(-400) }));
  const result = computeForecast(input),
    row = result.overview.rows[0],
    goal = result.goals[input.skus[0].id];
  assert.equal(row.seasonalityApplied, false);
  assert.match(row.methodLabel, /ML: ближайшие 30 дней/);
  assert.match(row.message, /проверен на ближайшие 30 дней/);
  assert.match(goal.sources![0].methodLabel, /ML: ближайшие 30 дней/);
  assert.equal(goal.sources![0].scenario, false);
});

test("forecast curves cover every Saturday in a thirty-day preparation window even at maximum settings", () => {
  const { input } = fixture();
  input.settings.horizonDays = 180;
  input.settings.safetyDays = 60;
  input.settings.leadDays = 90;
  input.series = [
    {
      ...history("ordered", () => 10),
      points: history("ordered", () => 10).points.slice(-14),
    },
    {
      ...history("cancelled", () => 0),
      points: history("cancelled", () => 0).points.slice(-14),
    },
  ];
  const source = computeForecast(input).goals[input.skus[0].id].sources![0];
  assert.equal(source.dailyForecast.length, 359);
  assert.equal(source.dailyForecast[0].date, "2025-12-20");
  assert.equal(source.dailyForecast.at(-1)!.date, "2026-12-13");
});

test("30-day learned segment reaches a 106-day planning curve while its tail remains the deployed fallback", () => {
  const { input } = fixture();
  input.series = [
    history("ordered", (i) => (i % 7 < 5 ? 10 : 40)),
    history("cancelled", () => 0),
  ].map((s) => ({ ...s, points: s.points.slice(-180) }));
  const result = computeForecast(input),
    goal = result.goals[input.skus[0].id],
    source = goal.sources![0];
  assert.equal(source.dailyForecast.length, 106);
  assert.match(
    source.methodLabel,
    /ML: ближайшие 30 дней; далее текущий спрос/,
  );
  const baseline = baselineForecastSource(input, "ozon", "one", 106);
  assert.deepEqual(
    source.dailyForecast.slice(30),
    baseline.dailyForecast.slice(30),
  );
  const candidate = result.overview.rows[0].sources[0].candidates.find(
    (c) => c.model === "autoregressive",
  )!;
  assert.equal(candidate.eligible, true);
  assert.equal(candidate.folds, 3);
  assert.match(candidate.reason!, /30 дней/);
  assert.equal(source.salesForecastKnown, true);
});

test("unknown demand is distinct from an explicitly observed zero and never becomes a known zero forecast", () => {
  const { input } = fixture();
  input.snapshots[0].demand = [];
  assert.equal(
    baselineForecastSource(input, "ozon", "one", 106).salesForecastKnown,
    false,
  );
  const missing = computeForecast(input).goals[input.skus[0].id].sources![0];
  assert.equal(missing.salesForecastKnown, false);
  input.snapshots[0].demand = [
    {
      externalId: "one",
      date: input.asOf,
      orderedUnits: 0,
      cancelledUnits: 0,
      soldUnits: 0,
      returnedUnits: 0,
    },
  ];
  const zero = baselineForecastSource(input, "ozon", "one", 106);
  assert.equal(zero.salesForecastKnown, true);
  assert.ok(zero.dailyForecast.every((p) => p.units === 0));
  input.snapshots[0].coverage.demand = false;
  assert.equal(
    baselineForecastSource(input, "ozon", "one", 106).salesForecastKnown,
    false,
  );
});

test("monthly annual winner reaches provider plan and seasonal labels while distant tail remains unvalidated fallback", () => {
  const { input } = fixture();
  const ordered = history(
    "ordered",
    (i) => 30 + 25 * Math.sin((2 * Math.PI * i) / 365),
  );
  ordered.points = ordered.points.slice(0, 600);
  const cancelled = {
    ...ordered,
    metric: "cancelled" as const,
    points: ordered.points.map((p) => ({ ...p, units: 0 })),
  };
  input.asOf = ordered.points.at(-1)!.date;
  input.series = [ordered, cancelled];
  const result = computeForecast(input);
  const row = result.overview.rows[0];
  const source = result.goals[row.skuId].sources![0];
  const baseline = baselineForecastSource(
    input,
    "ozon",
    "one",
    source.dailyForecast.length,
  );
  assert.equal(row.seasonalityApplied, true);
  assert.equal(row.methodLabel, "Прогноз с сезонностью");
  assert.doesNotMatch(source.methodLabel, /ML/);
  assert.match(source.methodLabel, /ближайшие 30 дней/);
  assert.equal(source.salesForecastKnown, true);
  assert.equal(source.scenario, false);
  assert.deepEqual(
    source.dailyForecast.slice(30),
    baseline.dailyForecast.slice(30),
  );
  assert.notDeepEqual(
    source.dailyForecast.slice(0, 30),
    baseline.dailyForecast.slice(0, 30),
  );
  assert.ok(
    row.sources[0].candidates.some(
      (c) =>
        ["annual_seasonal_monthly", "annual_growth_monthly"].includes(
          c.model,
        ) &&
        c.eligible &&
        c.folds === 3,
    ),
  );
});
