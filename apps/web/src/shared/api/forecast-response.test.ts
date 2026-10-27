import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isForecastOverviewResponse,
  isForecastHistoryOverviewResponse,
  isForecastHistorySeriesResponse,
} from "./forecast-response";
const candidate = {
  model: "mean",
  label: "Средний спрос",
  eligible: true,
  reason: null,
  mae: 2,
  wape: 0.2,
  bias: -1,
  folds: 4,
};
const source = {
  provider: "ozon",
  metricLabel: "Заказы",
  modelLabel: "Средний спрос",
  predictedUnits: 25,
  historyDays: 365,
  candidates: [candidate],
  points: [
    { date: "2026-10-25", actual: 4, predicted: null },
    { date: "2026-10-26", actual: null, predicted: 5 },
  ],
};
const row = {
  skuId: "sku",
  skuName: "Котики",
  minimumBoxes: 1,
  seasonalityEnabled: true,
  targetUnits: 30,
  seasonalityApplied: false,
  methodLabel: "Средний спрос",
  confidenceLabel: "Предварительная оценка",
  message: "История ещё загружается",
  historyFrom: "2025-10-25",
  historyTo: "2026-10-25",
  knownDays: 365,
  sources: [source],
};
const overview = {
  ready: true,
  computing: false,
  message: "Прогноз готов",
  generatedAt: "2026-10-26T00:00:00Z",
  rows: [row],
};
test("forecast guard accepts nullable unknown chart values and signed bias but rejects broken model quality and incomplete rows", () => {
  assert.equal(isForecastOverviewResponse(overview), true);
  assert.equal(
    isForecastOverviewResponse({
      ...overview,
      rows: [
        {
          ...row,
          sources: [{ ...source, candidates: [{ ...candidate, mae: NaN }] }],
        },
      ],
    }),
    false,
  );
  assert.equal(
    isForecastOverviewResponse({
      ...overview,
      rows: [{ ...row, targetUnits: -1 }],
    }),
    false,
  );
  assert.equal(
    isForecastOverviewResponse({
      ...overview,
      rows: [
        {
          ...row,
          sources: [
            {
              ...source,
              points: [{ date: "2026-02-31", actual: 0, predicted: null }],
            },
          ],
        },
      ],
    }),
    false,
  );
  const { message, ...missing } = row;
  assert.equal(
    isForecastOverviewResponse({ ...overview, rows: [missing] }),
    false,
  );
  assert.equal(
    isForecastOverviewResponse({
      ...overview,
      rows: [{ ...row, sources: [{ ...source, provider: "other" }] }],
    }),
    false,
  );
});
test("history response requires a valid provider, calendar dates, configured state and known job statuses", () => {
  const provider = {
      provider: "wildberries",
      financeConfigured: false,
      firstSaleDate: "2025-02-03",
      lastSaleDate: "2026-10-25",
      ordersKnownDays: 56,
      salesEventDays: 500,
      archiveFrom: "2024-01-29",
      archiveThrough: "2026-10-25",
      archiveComplete: true,
      archiveScope: "sale_date",
      from: null,
      to: null,
      knownDays: 0,
      products: 0,
      message: "Нужен доступ",
    },
    job = {
      id: "job",
      provider: "wildberries",
      from: "2024-01-29",
      to: "2026-10-25",
      loadedThrough: "",
      status: "permission_required",
      message: "Нужен доступ",
      pages: 0,
    };
  assert.equal(
    isForecastHistoryOverviewResponse({ providers: [provider], jobs: [job] }),
    true,
  );
  assert.equal(
    isForecastHistoryOverviewResponse({
      providers: [{ ...provider, financeConfigured: undefined }],
      jobs: [],
    }),
    false,
  );
  assert.equal(
    isForecastHistoryOverviewResponse({
      providers: [],
      jobs: [{ ...job, status: "unexpected" }],
    }),
    false,
  );
  assert.equal(
    isForecastHistoryOverviewResponse({
      providers: [],
      jobs: [{ ...job, loadedThrough: "2026-02-31" }],
    }),
    false,
  );
});
test("history series guard keeps unknown days distinct from zero and rejects financial/operational metric typos", () => {
  const series = {
    skuId: "sku",
    storeId: "store",
    provider: "ozon",
    externalId: "123",
    metric: "ordered",
    source: "ozon_fbo",
    points: [
      { date: "2026-10-25", units: null, availability: "unknown" },
      { date: "2026-10-26", units: 0, availability: "out_of_stock" },
    ],
  };
  assert.equal(isForecastHistorySeriesResponse([series]), true);
  assert.equal(
    isForecastHistorySeriesResponse([{ ...series, metric: "sales" }]),
    false,
  );
  assert.equal(
    isForecastHistorySeriesResponse([
      {
        ...series,
        points: [
          { date: "2026-10-25", units: Infinity, availability: "available" },
        ],
      },
    ]),
    false,
  );
});

test("existing charts accept actual and saved forecast on the same date with valid publication metadata", () => {
  const point = {
    date: "2026-10-26",
    actual: 7,
    predicted: 8,
    predictedAt: "2026-10-25T10:00:00Z",
  };
  const response = {
    ...overview,
    rows: [
      {
        ...row,
        sources: [{ ...source, forecastFrom: "2026-10-27", points: [point] }],
      },
    ],
  };
  assert.equal(isForecastOverviewResponse(response), true);
  assert.equal(
    isForecastOverviewResponse({
      ...response,
      rows: [
        {
          ...row,
          sources: [
            { ...response.rows[0].sources[0], forecastFrom: "2026-02-31" },
          ],
        },
      ],
    }),
    false,
  );
  assert.equal(
    isForecastOverviewResponse({
      ...response,
      rows: [
        {
          ...row,
          sources: [
            { ...source, points: [{ ...point, predictedAt: "invalid" }] },
          ],
        },
      ],
    }),
    false,
  );
});
