import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  overlayForecastChartHistory,
  type ForecastSavedChartPoint,
} from "../src/forecasting/chart-history";
import type { ForecastCache } from "../src/forecasting/forecast-storage";
import {
  forecastChartHistoryKey,
  type ForecastChartIdentity,
} from "../src/forecasting/journal-types";
import type { ForecastHistorySeries } from "../src/forecasting/history-types";

function fixture(): ForecastCache {
  const identities: ForecastChartIdentity[] = (
    ["net_ordered", "sold", "returned"] as const
  )
    .flatMap((metric) =>
      ["card-a", "card-b"].map((externalId) => ({
        skuId: "cats",
        sourceIndex: 0,
        scopeKey: "scope-a",
        provider: "ozon" as const,
        storeId: "store-a",
        externalId,
        metric,
        unitsPerItem: 1,
        historyKey: forecastChartHistoryKey("scope-a", externalId, metric),
      })),
    )
    .map((identity, sourceIndex) => ({ ...identity, sourceIndex }));
  return {
    key: "current",
    generatedAt: "2026-10-30T10:00:00Z",
    modelVersion: "test",
    fingerprints: [],
    goals: {},
    chartIdentities: identities,
    overview: {
      ready: true,
      computing: false,
      message: "",
      generatedAt: "2026-10-30T10:00:00Z",
      rows: [
        {
          skuId: "cats",
          skuName: "Котики",
          minimumBoxes: 0,
          seasonalityEnabled: true,
          targetUnits: 100,
          seasonalityApplied: false,
          methodLabel: "Спрос",
          confidenceLabel: "",
          message: "",
          historyFrom: "2026-10-27",
          historyTo: "2026-10-29",
          knownDays: 3,
          sources: identities.map((identity) => ({
            provider: identity.provider,
            forecastFrom: "2026-10-30",
            metricLabel: "Переведённое название",
            modelLabel: "ML",
            predictedUnits: 30,
            historyDays: 3,
            candidates: [],
            points: [
              { date: "2026-10-27", actual: 4, predicted: null },
              { date: "2026-10-28", actual: 0, predicted: null },
              { date: "2026-10-29", actual: null, predicted: null },
              { date: "2026-10-30", actual: null, predicted: 30 },
            ],
          })),
        },
      ],
    },
  };
}
function saved(
  cache: ForecastCache,
  sourceIndex: number,
  values: Partial<ForecastSavedChartPoint> = {},
): ForecastSavedChartPoint {
  return {
    historyKey: cache.chartIdentities![sourceIndex].historyKey,
    date: "2026-10-28",
    units: 6,
    publishedAt: "2026-10-27T19:00:00Z",
    ...values,
  };
}
test("existing charts combine saved prospective predictions with real facts and known zero without cache mutation", () => {
  const cache = fixture(),
    before = JSON.stringify(cache);
  const result = overlayForecastChartHistory(
    cache,
    [saved(cache, 0), saved(cache, 0, { date: "2026-10-29", units: 7 })],
    ["scope-a"],
    "2026-10-29",
  );
  const points = result.rows[0].sources[0].points;
  assert.deepEqual(points[1], {
    date: "2026-10-28",
    actual: 0,
    predicted: 6,
    predictedAt: "2026-10-27T19:00:00Z",
  });
  assert.equal(points[2].actual, null);
  assert.equal(points[2].predicted, 7);
  assert.equal(points[3].predicted, 30);
  assert.equal(result.rows[0].sources[0].forecastFrom, "2026-10-30");
  assert.equal(result.rows[0].sources[0].predictedUnits, 30);
  assert.equal(JSON.stringify(cache), before);
});
test("identical labels never blend cards, metrics or inactive account scopes", () => {
  const cache = fixture();
  const result = overlayForecastChartHistory(
    cache,
    cache.chartIdentities!.map((_, index) =>
      saved(cache, index, { units: index + 10 }),
    ),
    ["scope-a"],
    "2026-10-29",
  );
  assert.deepEqual(
    result.rows[0].sources.map((source) => source.points[1].predicted),
    [10, 11, 12, 13, 14, 15],
  );
  assert.equal(
    overlayForecastChartHistory(
      cache,
      [saved(cache, 0)],
      ["scope-b"],
      "2026-10-29",
    ).rows[0].sources[0].points[1].predicted,
    null,
  );
  assert.notEqual(
    forecastChartHistoryKey("scope-a", "card-a", "sold"),
    forecastChartHistoryKey("scope-b", "card-a", "sold"),
  );
});
test("Moscow day cutoff rejects same-day, late and future records; latest eligible publication wins", () => {
  const cache = fixture();
  const result = overlayForecastChartHistory(
    cache,
    [
      saved(cache, 0, { units: 1, publishedAt: "2026-10-26T12:00:00Z" }),
      saved(cache, 0, { units: 2, publishedAt: "2026-10-27T20:59:59Z" }),
      saved(cache, 0, { units: 999, publishedAt: "2026-10-27T21:00:00Z" }),
      saved(cache, 0, { units: 999, publishedAt: "2026-10-28T12:00:00Z" }),
      saved(cache, 0, { units: 999, date: "2026-10-30" }),
      saved(cache, 0, { units: Number.NaN }),
      saved(cache, 0, { units: -1 }),
      saved(cache, 0, { publishedAt: "invalid" }),
    ],
    ["scope-a"],
    "2026-10-29",
  );
  assert.equal(result.rows[0].sources[0].points[1].predicted, 2);
  assert.equal(
    result.rows[0].sources[0].points[1].predictedAt,
    "2026-10-27T20:59:59Z",
  );
  assert.equal(result.rows[0].sources[0].points[3].predicted, 30);
  assert.equal(
    overlayForecastChartHistory(
      cache,
      [saved(cache, 0)],
      ["scope-a"],
      "2026-10-27",
    ).rows[0].sources[0].points[1].predicted,
    null,
  );
});
test("a saved missing historical date is a gap in actual data, never an invented zero", () => {
  const cache = fixture();
  const result = overlayForecastChartHistory(
    cache,
    [
      saved(cache, 0, {
        date: "2026-10-26",
        publishedAt: "2026-10-25T10:00:00Z",
      }),
    ],
    ["scope-a"],
    "2026-10-29",
  );
  assert.deepEqual(result.rows[0].sources[0].points[0], {
    date: "2026-10-26",
    actual: null,
    predicted: 6,
    predictedAt: "2026-10-25T10:00:00Z",
  });
});

function history(
  metric: ForecastHistorySeries["metric"],
  units: number | null,
): ForecastHistorySeries {
  return {
    skuId: "cats",
    provider: "ozon",
    storeId: "store-a",
    externalId: "card-a",
    metric,
    source: "ozon_fbo",
    points: [
      { date: "2026-10-29", units, availability: "unknown" },
      { date: "2026-10-30", units: 999, availability: "unknown" },
    ],
  };
}
test("current facts join launch charts by exact card and metric while future facts remain unavailable", () => {
  const cache = fixture();
  cache.overview.rows[0].sources.forEach((source) => {
    source.points = source.points.filter((point) => point.predicted !== null);
  });
  const facts = [
    history("ordered", 12),
    history("cancelled", 2),
    history("sold", 7),
    history("returned", 1),
    { ...history("ordered", 999), storeId: "another-store" },
  ];
  const result = overlayForecastChartHistory(
    cache,
    [],
    ["scope-a"],
    "2026-10-29",
    facts,
  );
  const sources = result.rows[0].sources;
  assert.equal(
    sources[0].points.find((point) => point.date === "2026-10-29")!.actual,
    10,
  );
  assert.equal(
    sources[2].points.find((point) => point.date === "2026-10-29")!.actual,
    7,
  );
  assert.equal(
    sources[4].points.find((point) => point.date === "2026-10-29")!.actual,
    1,
  );
  assert.equal(
    sources[1].points.find((point) => point.date === "2026-10-29"),
    undefined,
  );
  assert.ok(
    sources.every(
      (source) =>
        source.points.find((point) => point.date === "2026-10-30")!.actual ===
        null,
    ),
  );
  assert.equal(sources[0].points[0].predicted, null);
});
test("unknown cancellation cannot become a known net-order actual, while a real zero remains visible", () => {
  const cache = fixture();
  const absent = overlayForecastChartHistory(
    cache,
    [],
    ["scope-a"],
    "2026-10-29",
    [history("ordered", 5)],
  );
  assert.equal(
    absent.rows[0].sources[0].points.find(
      (point) => point.date === "2026-10-29",
    )!.actual,
    null,
  );
  const zero = overlayForecastChartHistory(
    cache,
    [],
    ["scope-a"],
    "2026-10-29",
    [history("ordered", 0), history("cancelled", 0)],
  );
  assert.equal(
    zero.rows[0].sources[0].points.find((point) => point.date === "2026-10-29")!
      .actual,
    0,
  );
});
