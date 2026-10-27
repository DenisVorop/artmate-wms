import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedWorkspace } from "../src/seed";
import {
  baselineForecastSource,
  computeForecast,
  type ForecastComputeInput,
} from "../src/forecasting/forecast-projection";
import { resolveLaunchForecast } from "../src/forecasting/launch-forecast";
import { defaultSettings } from "../src/marketplaces/storage";
import type { MarketplaceProvider } from "../src/marketplaces/providers/types";
import type { ForecastHistorySeries } from "../src/forecasting/history-types";
import type { ForecastPlanSource } from "../src/forecasting/forecast-storage";

const DAY = 86400000;
function fixture() {
  const sample = seedWorkspace().skus[0]!;
  const input: ForecastComputeInput = {
    key: "launch-test",
    asOf: "2026-10-26",
    generatedAt: "2026-10-27T09:00:00Z",
    skus: Array.from({ length: 5 }, (_, i) => ({
      ...sample,
      id: `sku-${i}`,
      name: i ? `Тема ${i}` : "Новый год",
      unitsPerBox: 20,
    })),
    policies: [],
    settings: defaultSettings,
    mappings: [],
    snapshots: [],
    series: [],
    connections: [
      { provider: "wildberries", storeId: "wb-shop", version: 2 },
      { provider: "ozon", storeId: "ozon-shop", version: 1 },
    ],
    resolutions: [
      {
        id: "launch",
        kind: "launch",
        provider: "wildberries",
        externalId: "wb-0",
        skuId: "sku-0",
        storeId: "wb-shop",
        connectionVersion: 2,
        donorProvider: "ozon",
        donorStoreId: "ozon-shop",
        donorConnectionVersion: 1,
        enabled: true,
        note: "Новинка ожидает приёмки",
        confirmedAt: "2026-10-27T08:00:00Z",
        expiresAt: null,
        actorAccountId: "manager",
        revision: 1,
      },
    ],
  };
  for (let i = 0; i < 5; i++) {
    input.policies.push({
      skuId: `sku-${i}`,
      minimumBoxes: 0,
      seasonalityEnabled: true,
    });
    for (const provider of ["wildberries", "ozon"] as const) {
      input.mappings.push({
        provider,
        externalId: `${provider === "ozon" ? "oz" : "wb"}-${i}`,
        skuId: `sku-${i}`,
        unitsPerItem: 1,
      });
      for (const metric of ["ordered", "cancelled"] as const) {
        const history: ForecastHistorySeries = {
          skuId: `sku-${i}`,
          externalId: `${provider === "ozon" ? "oz" : "wb"}-${i}`,
          storeId: `${provider === "ozon" ? "ozon" : "wb"}-shop`,
          provider,
          metric,
          source: "operational_snapshot",
          points: Array.from({ length: 30 }, (_, day) => ({
            date: new Date(Date.parse(input.asOf) - (29 - day) * DAY)
              .toISOString()
              .slice(0, 10),
            units:
              metric === "cancelled"
                ? 0
                : i === 0 && provider === "wildberries"
                  ? 0
                  : provider === "wildberries"
                    ? i * 2
                    : 10,
            availability:
              i === 0 && provider === "wildberries"
                ? "out_of_stock"
                : "unknown",
          })),
        };
        input.series.push(history);
      }
    }
  }
  return input;
}
const base: Omit<ForecastPlanSource, "provider"> = {
  dailyForecast: [{ date: "2026-10-27", units: 99 }],
  methodLabel: "Свой спрос",
  confidenceLabel: "Высокая уверенность",
  scenario: false,
  salesForecastKnown: true,
};
const curve = (days: number) => ({
  ...base,
  dailyForecast: Array.from({ length: days }, (_, i) => ({
    date: new Date(Date.parse("2026-10-27") + i * DAY)
      .toISOString()
      .slice(0, 10),
    units: 10 + i,
  })),
});
const run = (input: ForecastComputeInput, days = 30) =>
  resolveLaunchForecast(
    input,
    "wildberries",
    "wb-0",
    days,
    base,
    (_p, _id, horizon) => curve(horizon),
  );

test("launch uses robust median same-SKU donor ratio and preserves donor holiday curve", () => {
  const input = fixture(),
    before = JSON.stringify(input);
  const result = run(input);
  // Ratios .2 .4 .6 .8 -> median .5; no extra New Year multiplier.
  assert.equal(result.dailyForecast[0]!.units, 5);
  assert.equal(result.dailyForecast[29]!.units, 19.5);
  assert.equal(result.scenario, true);
  assert.equal(result.salesForecastKnown, true);
  assert.match(result.methodLabel, /Прогноз запуска новинки/);
  assert.equal(result.confidenceLabel, "Предварительная оценка");
  assert.equal(JSON.stringify(input), before);
});
test("launch with fewer than three analogue SKUs remains unknown rather than an arbitrary factor", () => {
  const input = fixture();
  input.skus = input.skus.slice(0, 3);
  const result = run(input);
  assert.equal(result.salesForecastKnown, false);
  assert.match(result.methodLabel, /недостаточно сопоставимых/);
});
test("unknown, stockout and financial days cannot provide analogue evidence", () => {
  for (const mode of ["missing", "stockout", "financial"] as const) {
    const input = fixture();
    for (const series of input.series.filter((s) => s.skuId !== "sku-0")) {
      if (mode === "missing")
        series.points.slice(0, 20).forEach((p) => {
          p.units = null;
        });
      if (mode === "stockout")
        series.points.slice(0, 20).forEach((p) => {
          p.availability = "out_of_stock";
        });
      if (mode === "financial")
        series.metric = series.metric === "ordered" ? "sold" : "returned";
    }
    assert.equal(run(input).salesForecastKnown, false, mode);
  }
});
test("known zeros on complete comparable days remain part of demand share", () => {
  const input = fixture();
  for (const series of input.series.filter(
    (s) =>
      s.provider === "wildberries" &&
      s.skuId !== "sku-0" &&
      s.metric === "ordered",
  ))
    series.points.slice(0, 15).forEach((p) => {
      p.units = 0;
    });
  // Median share is .25, not .5 from selecting only days with positive WB demand.
  assert.equal(run(input).dailyForecast[0]!.units, 2.5);
});
test("different transport packaging and ambiguous card mappings do not become analogues", () => {
  const input = fixture();
  input.skus[1]!.unitsPerBox = 4;
  input.mappings.push({
    provider: "ozon",
    externalId: "duplicate",
    skuId: "sku-2",
    unitsPerItem: 1,
  });
  assert.equal(run(input).salesForecastKnown, false);
});
test("expired, wrong-account, changed-connection, remapped and disabled launch policies are ignored", () => {
  for (const mode of [
    "expired",
    "account",
    "version",
    "sku",
    "disabled",
  ] as const) {
    const input = fixture(),
      resolution = input.resolutions![0]!;
    if (mode === "expired") resolution.expiresAt = "2026-10-01T00:00:00Z";
    if (mode === "account") resolution.storeId = "different-shop";
    if (mode === "version") resolution.connectionVersion++;
    if (mode === "sku") resolution.skuId = "remapped";
    if (mode === "disabled") resolution.enabled = false;
    assert.deepEqual(run(input), base, mode);
  }
});
test("future days cannot train launch ratios or replace own demand", () => {
  const input = fixture();
  for (const series of input.series)
    series.points.push({
      date: "2027-01-01",
      units: series.provider === "wildberries" ? 99999 : 1,
      availability: "available",
    });
  assert.equal(run(input).dailyForecast[0]!.units, 5);
});
test("fourteen known saleable own days replace the launch scenario automatically", () => {
  const input = fixture();
  for (const series of input.series.filter((s) => s.externalId === "wb-0"))
    series.points.slice(-14).forEach((p) => {
      p.availability = "available";
    });
  assert.deepEqual(run(input), base);
});
test("unknown donor forecast cannot produce a known launch estimate", () => {
  const result = resolveLaunchForecast(
    fixture(),
    "wildberries",
    "wb-0",
    30,
    base,
    () => ({ ...curve(30), salesForecastKnown: false }),
  );
  assert.equal(result.salesForecastKnown, false);
});
test("snapshot fallback does not invent history before first product appearance", () => {
  const input = fixture();
  input.series = [];
  for (const provider of ["ozon", "wildberries"] as MarketplaceProvider[])
    input.snapshots.push({
      provider,
      asOf: input.generatedAt,
      from: "2026-09-01",
      to: input.asOf,
      products: [],
      stocks: [],
      coverage: { catalog: true, demand: true, stocks: true, inbound: true },
      warnings: [],
      demand: input.mappings
        .filter((m) => m.provider === provider)
        .map((m) => ({
          externalId: m.externalId,
          date: "2026-10-26",
          orderedUnits: 10,
          cancelledUnits: 0,
          soldUnits: null,
          returnedUnits: 0,
        })),
    });
  assert.equal(run(input).salesForecastKnown, false);
});
test("cached forecast and synchronous fallback use identical launch quantities without claiming validated ML", () => {
  const input = fixture();
  const cache = computeForecast(input),
    source = cache.goals["sku-0"]!.sources!.find(
      (s) => s.provider === "wildberries",
    )!;
  const baseline = baselineForecastSource(
    input,
    "wildberries",
    "wb-0",
    source.dailyForecast.length,
  );
  assert.deepEqual(source.dailyForecast, baseline.dailyForecast);
  assert.equal(source.salesForecastKnown, true);
  assert.match(cache.goals["sku-0"]!.methodLabel, /запуска/);
  const row = cache.overview.rows.find((r) => r.skuId === "sku-0")!;
  assert.equal(
    row.sources.find((s) => s.provider === "wildberries")!.candidates.length,
    0,
  );
  assert.equal(row.seasonalityApplied, false);
});

test("planning uses confirmed zero plus pending inbound and launch demand without rewriting raw API snapshots", async () => {
  const { marketplacePlan } = await import("../src/marketplaces/planning");
  const input = fixture();
  const w = seedWorkspace();
  w.skus = input.skus;
  w.tasks = [];
  w.boxes = [];
  w.shipments = [];
  const m: import("../src/marketplaces/storage").MarketplaceState = {
    settings: input.settings,
    mappings: input.mappings,
    transit: {},
    resolutions: [
      ...input.resolutions!,
      {
        ...input.resolutions![0]!,
        id: "zero",
        kind: "zero_stock",
        donorProvider: undefined,
      },
    ],
    connections: input.connections.map((c) => ({
      provider: c.provider,
      historyStoreId: c.storeId!,
      version: c.version!,
      lastSuccessVersion: c.version,
      encrypted: "not-used",
      clientId: null,
      enabled: true,
      syncStatus: "success",
      lastAttemptAt: input.generatedAt,
      lastSuccessAt: input.generatedAt,
      message: null,
      warnings: [],
      runId: null,
    })),
    snapshots: [],
  };
  for (const provider of ["ozon", "wildberries"] as const) {
    const maps = input.mappings.filter((m) => m.provider === provider);
    m.snapshots.push({
      provider,
      asOf: input.generatedAt,
      from: "2026-09-01",
      to: input.asOf,
      products: maps.map((m) => ({
        externalId: m.externalId,
        name: m.externalId,
        barcodes: [],
      })),
      stocks: maps
        .filter((m) => m.externalId !== "wb-0")
        .map((m) => ({
          externalId: m.externalId,
          warehouseId: "api",
          warehouseName: "API",
          availableUnits: 50,
          reservedUnits: 0,
          inboundUnits: 0,
        })),
      inbound: maps.map((m) => ({
        externalId: m.externalId,
        units: m.externalId === "wb-0" ? 100 : 0,
        source: provider === "ozon" ? "ozon_analytics" : "wb_supplies",
        supplyIds: m.externalId === "wb-0" ? ["pending"] : [],
        warnings: [],
      })),
      demand: input.series
        .filter(
          (s) =>
            s.provider === provider &&
            s.metric === "ordered" &&
            s.externalId !== "wb-0",
        )
        .flatMap((s) =>
          s.points.map((p) => ({
            externalId: s.externalId,
            date: p.date,
            orderedUnits: p.units!,
            cancelledUnits: 0,
            returnedUnits: 0,
            soldUnits: null,
          })),
        ),
      coverage: { catalog: true, demand: true, stocks: true, inbound: true },
      warnings: [],
    });
  }
  const before = JSON.stringify(m.snapshots);
  const result = marketplacePlan(w, m, new Date(input.generatedAt));
  const row = result.rows.find((r) => r.skuId === "sku-0")!;
  const wb = row.providers.find((p) => p.provider === "wildberries")!;
  assert.equal(wb.marketplaceUnits, 0);
  assert.equal(wb.inTransitUnits, 100);
  assert.equal(wb.salesForecastKnown, true);
  assert.match(wb.methodLabel, /запуска/);
  assert.equal(wb.expectedSalesUnits30, 150);
  assert.equal(
    row.blockers.some((r) =>
      /неизвестен остаток|Недостаточно подтверждённой истории/.test(r),
    ),
    false,
  );
  assert.equal(JSON.stringify(m.snapshots), before);
});
