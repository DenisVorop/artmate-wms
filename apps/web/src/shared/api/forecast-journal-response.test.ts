import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isForecastJournalListResponse,
  isForecastJournalDetailResponse,
} from "./forecast-journal-response";
import { createApiFetch } from "./transport";
const summary = {
  id: "a".repeat(64),
  generatedAt: "2026-10-27T09:00:00Z",
  publishedAt: "2026-10-27T09:01:00Z",
  asOf: "2026-10-26",
  modelVersion: "v1",
  seriesCount: 1,
  from: "2026-10-27",
  to: "2026-11-25",
};
const row = {
  id: "b".repeat(64),
  scopeKey: "c".repeat(64),
  skuId: "cats",
  skuName: "Котики",
  provider: "ozon",
  metric: "net_ordered",
  modelLabel: "ML",
  scenario: false,
  points: [
    {
      date: "2026-10-28",
      predicted: 10,
      basePredicted: 12,
      factor: 10 / 12,
      actual: null,
      status: "pending",
    },
  ],
  comparablePredicted: 0,
  actual: 0,
  mae: null,
  wape: null,
  bias: null,
  scoredDays: 0,
  pendingDays: 1,
  unknownDays: 0,
  stockoutDays: 0,
};
const detail = { ...summary, evaluatedAsOf: "2026-10-27", rows: [row] };
test("archive guards preserve unknown versus zero and signed bias; malformed metrics/dates/quantities rejected", () => {
  assert.equal(
    isForecastJournalListResponse({ runs: [summary], nextCursor: null }),
    true,
  );
  assert.equal(
    isForecastJournalListResponse({ runs: [summary], nextCursor: "bad" }),
    false,
  );
  assert.equal(isForecastJournalDetailResponse(detail), true);
  assert.equal(
    isForecastJournalDetailResponse({
      ...detail,
      rows: [
        {
          ...row,
          bias: -2,
          mae: 3,
          wape: 1.4,
          points: [{ ...row.points[0], actual: 0, status: "scored" }],
        },
      ],
    }),
    true,
  );
  for (const patch of [
    { metric: "sold" },
    { scoredDays: -1 },
    { mae: NaN },
    { points: [{ ...row.points[0], actual: -1 }] },
    { points: [{ ...row.points[0], date: "2026-02-31" }] },
    { points: [{ ...row.points[0], status: "confirmed" }] },
  ])
    assert.equal(
      isForecastJournalDetailResponse({
        ...detail,
        rows: [{ ...row, ...patch }],
      }),
      false,
    );
});
test("transport routes journal list and detail through distinct runtime guards without replay storage", async () => {
  const api = createApiFetch({
    fetch: async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes(`/${summary.id}`)
            ? detail
            : { runs: [summary], nextCursor: null },
        ),
        { status: 200 },
      ),
    storage: () => {
      throw new Error("must not access replay");
    },
  });
  assert.deepEqual(await api("/api/forecast/journal?limit=20"), {
    runs: [summary],
    nextCursor: null,
  });
  assert.deepEqual(await api(`/api/forecast/journal/${summary.id}`), detail);
  const broken = createApiFetch({
    fetch: async () =>
      new Response(JSON.stringify({ rows: [] }), { status: 200 }),
    storage: () => {
      throw new Error("no replay");
    },
  });
  await assert.rejects(broken("/api/forecast/journal"), /некорректный прогноз/);
});
