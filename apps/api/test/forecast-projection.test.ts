import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedWorkspace } from "../src/seed";
import {
  computeForecast,
  baselineForecastOverview,
  type ForecastComputeInput,
} from "../src/forecasting/forecast-projection";
import { computeForecastInWorker } from "../src/forecasting/forecast-worker";
import { marketplacePlan } from "../src/marketplaces/planning";
import {
  defaultSettings,
  type MarketplaceState,
} from "../src/marketplaces/storage";
import type { ForecastHistorySeries } from "../src/forecasting/history-types";

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
test("a fallback goal exactly matches the existing net-order mean, without replacing it with sparse archive mean", () => {
  const { w, m, input } = fixture();
  input.series = [
    {
      ...history("ordered", () => 999),
      points: [{ date: "2025-12-19", units: 999, availability: "unknown" }],
    },
    {
      ...history("cancelled", () => 0),
      points: [{ date: "2025-12-19", units: 0, availability: "unknown" }],
    },
  ];
  const result = computeForecast(input),
    legacy = marketplacePlan(w, m, clock).rows.find(
      (r) => r.skuId === input.skus[0].id,
    )!;
  assert.equal(result.goals[input.skus[0].id].targetUnits, legacy.targetUnits);
  assert.equal(result.overview.rows[0].seasonalityApplied, false);
  assert.equal(
    result.overview.rows[0].sources[0].predictedUnits,
    (64 / 56) * 77,
  );
  assert.equal(
    result.overview.rows[0].sources[0].points.filter(
      (p) => p.predicted !== null,
    )[0].predicted,
    64 / 56,
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
test("seasonality switch immediately restores the exact legacy mean; minimum boxes is a floor", () => {
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
    Math.max(Math.ceil((64 / 56) * 77), 3 * input.skus[0].unitsPerBox),
  );
  input.policies[0].minimumBoxes = 100;
  assert.equal(
    computeForecast(input).overview.rows[0].targetUnits,
    100 * input.skus[0].unitsPerBox,
  );
  assert.equal(
    baselineForecastOverview(input).rows[0].targetUnits,
    100 * input.skus[0].unitsPerBox,
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
      .slice(-300)
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
  assert.equal(source.modelLabel, "Сезон выкупов с проверкой по заказам");
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
