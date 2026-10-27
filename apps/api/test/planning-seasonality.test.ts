import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedWorkspace } from "../src/seed";
import { planningSeasonality } from "../src/forecasting/planning-seasonality";
import {
  computeForecast,
  type ForecastComputeInput,
} from "../src/forecasting/forecast-projection";
import { captureForecastJournal } from "../src/forecasting/journal-types";
import type { ForecastHistorySeries } from "../src/forecasting/history-types";
import { defaultSettings } from "../src/marketplaces/storage";

function fixture() {
  const base = seedWorkspace().skus[0];
  const skus = ["new", "peer-a", "peer-b", "marker"].map((id) => ({
    ...base,
    id,
    name: id,
  }));
  const asOf = "2026-10-26";
  const mappings = skus.map((sku) => ({
    provider: "ozon" as const,
    externalId: sku.id,
    skuId: sku.id,
    unitsPerItem: 1,
  }));
  const series: ForecastHistorySeries[] = [];
  for (const sku of skus) {
    const start = Date.parse(sku.id === "new" ? "2026-08-01" : "2024-01-01");
    const points = Array.from(
      { length: Math.floor((Date.parse(asOf) - start) / 86400000) + 1 },
      (_, i) => {
        const d = new Date(start + i * 86400000);
        const date = d.toISOString().slice(0, 10);
        return {
          date,
          units:
            sku.id === "marker"
              ? d.getUTCMonth() === 11
                ? 10000
                : 1
              : d.getUTCMonth() === 11
                ? 30
                : 10,
          availability: "unknown" as const,
        };
      },
    );
    series.push(
      {
        skuId: sku.id,
        provider: "ozon",
        storeId: "shop",
        externalId: sku.id,
        metric: "ordered",
        source: "ozon_fbo",
        points,
      },
      {
        skuId: sku.id,
        provider: "ozon",
        storeId: "shop",
        externalId: sku.id,
        metric: "cancelled",
        source: "ozon_fbo",
        points: points.map((p) => ({ ...p, units: 0 })),
      },
    );
  }
  const input: ForecastComputeInput = {
    key: "test",
    asOf,
    generatedAt: "2026-10-27T09:00:00Z",
    skus,
    mappings,
    connections: [{ provider: "ozon", storeId: "shop", version: 1 }],
    settings: {
      ...defaultSettings,
      historyDays: 89,
      horizonDays: 56,
      safetyDays: 14,
      leadDays: 7,
      dispatchWeekday: 6,
    },
    policies: skus.map((sku) => ({
      skuId: sku.id,
      minimumBoxes: 0,
      seasonalityEnabled: true,
    })),
    snapshots: [
      {
        provider: "ozon",
        asOf,
        from: asOf,
        to: asOf,
        products: skus.map((sku) => ({
          externalId: sku.id,
          name: sku.id === "marker" ? "Маркеры" : "Раскраска " + sku.name,
          barcodes: [],
        })),
        stocks: [],
        demand: [],
        warnings: [],
        coverage: { catalog: true, demand: true, stocks: true, inbound: true },
      },
    ],
    series,
  };
  return input;
}

test("new coloring receives only mature coloring peers; marker and another store cannot inflate the curve", () => {
  const input = fixture();
  const get = planningSeasonality(input, input.series, 106);
  const scenario = get("ozon", "new")!;
  assert.equal(scenario.origin, "category");
  assert.equal(scenario.donors, 2);
  assert.equal(scenario.scenario, true);
  assert.equal(
    scenario.dailyForecast.find((p) => p.date === "2026-12-15")!.units,
    30,
  );
  const contaminated = structuredClone(input);
  contaminated.series.push(
    ...input.series
      .filter((s) => s.skuId === "peer-a")
      .map((s) => ({
        ...s,
        storeId: "old",
        externalId: "old",
        points: s.points.map((p) => ({ ...p, units: 1e8 })),
      })),
  );
  // Root passes active series only: this scope is exactly the worker boundary.
  const active = contaminated.series.filter((s) => s.storeId === "shop");
  assert.deepEqual(
    planningSeasonality(contaminated, active, 106)("ozon", "new"),
    scenario,
  );
  const duplicate = structuredClone(input);
  duplicate.mappings.push({
    ...duplicate.mappings[1],
    externalId: "peer-a-copy",
  });
  duplicate.snapshots[0].products.push({
    externalId: "peer-a-copy",
    name: "Раскраска copy",
    barcodes: [],
  });
  duplicate.series.push(
    ...duplicate.series
      .filter((s) => s.skuId === "peer-a")
      .map((s) => ({ ...s, externalId: "peer-a-copy" })),
  );
  assert.equal(
    planningSeasonality(duplicate, duplicate.series, 106)("ozon", "new")!
      .donors,
    2,
  );
});

test("preliminary coherent seasonal curve reaches plan, original chart and immutable capture on every date", () => {
  const input = fixture();
  const scenario = planningSeasonality(
    input,
    input.series,
    106,
  )("ozon", "new")!;
  const cache = computeForecast(input);
  const source = cache.goals.new.sources![0];
  assert.equal(source.scenario, true);
  assert.deepEqual(source.dailyForecast, scenario.dailyForecast);
  const row = cache.overview.rows.find((r) => r.skuId === "new")!;
  assert.equal(row.methodLabel, "Сезонный сценарий");
  assert.equal(row.confidenceLabel, "Предварительная оценка");
  assert.equal(row.seasonalityApplied, true);
  const chart = row.sources.find(
    (s) => s.metricLabel === "Заказы за вычетом отмен",
  )!;
  assert.deepEqual(
    chart.points
      .filter((p) => p.predicted !== null)
      .map((p) => ({ date: p.date, units: p.predicted })),
    source.dailyForecast,
  );
  assert.equal(
    chart.candidates.find((c) => c.model === "seasonal_scenario_category")!
      .eligible,
    false,
  );
  const journal = captureForecastJournal(input, cache, input.generatedAt);
  assert.deepEqual(
    journal.charts!.find((c) => c.externalId === "new")!.points,
    source.dailyForecast,
  );
  assert.equal(source.dailyForecast[29].units, source.dailyForecast[30].units);
  assert.ok(
    source.dailyForecast.find((p) => p.date === "2026-12-15")!.units >
      source.dailyForecast[30].units,
  );
  input.policies.find((p) => p.skuId === "new")!.seasonalityEnabled = false;
  const disabled = computeForecast(input);
  assert.equal(
    disabled.overview.rows.find((r) => r.skuId === "new")!.seasonalityApplied,
    false,
  );
  assert.ok(
    disabled.goals.new.sources![0].dailyForecast.every((p) => p.units === 10),
  );
});

test("future observations cannot change own/category eligibility, curve or source model identity", () => {
  const input = fixture(),
    before = planningSeasonality(input, input.series, 106)("ozon", "new");
  for (const s of input.series)
    s.points.push({
      date: "2026-12-15",
      units: 1e9,
      availability: "available",
    });
  assert.deepEqual(
    planningSeasonality(input, input.series, 106)("ozon", "new"),
    before,
  );
});
