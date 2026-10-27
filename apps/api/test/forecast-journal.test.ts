import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Queryable } from "../src/database";
import type { ForecastCache } from "../src/forecasting/forecast-storage";
import type { ForecastHistorySeries } from "../src/forecasting/history-types";
import {
  captureForecastJournal,
  forecastJournalScopes,
  type ForecastJournalInput,
  type ForecastJournalRun,
} from "../src/forecasting/journal-types";
import {
  compareForecastJournal,
  journalActualPoints,
} from "../src/forecasting/journal-comparison";
import {
  appendForecastJournal,
  initializeForecastJournalStorage,
  listForecastJournal,
  readForecastJournal,
  readForecastJournalFeedback,
} from "../src/forecasting/journal-storage";
function input(): ForecastJournalInput {
  return {
    key: "a".repeat(64),
    generatedAt: "2026-10-01T10:00:00Z",
    asOf: "2026-09-30",
    skus: [
      {
        id: "cats",
        code: "CATS",
        name: "Котики",
        barcode: "123",
        unitsPerBox: 20,
        color: "mint",
        packaging: {
          boxWidthMm: 300,
          boxDepthMm: 200,
          boxHeightMm: 150,
          palletWidthMm: 800,
          palletDepthMm: 1200,
          palletBaseHeightMm: 150,
          boxesPerLayer: 6,
          maxLayers: 3,
          boxWeightKg: null,
          palletWeightKg: null,
        },
      },
    ],
    connections: [{ provider: "ozon", storeId: "seller-1", version: 1 }],
    settings: {
      historyDays: 89,
      horizonDays: 56,
      safetyDays: 14,
      leadDays: 7,
      dispatchWeekday: 6,
    },
    mappings: [
      {
        provider: "ozon",
        externalId: "card-a",
        skuId: "cats",
        unitsPerItem: 2,
      },
      {
        provider: "ozon",
        externalId: "card-b",
        skuId: "cats",
        unitsPerItem: 1,
      },
    ],
  };
}
function cache(i = input()): ForecastCache {
  return {
    key: i.key,
    generatedAt: i.generatedAt,
    modelVersion: "test-v1",
    fingerprints: [],
    overview: {
      ready: true,
      computing: false,
      message: "",
      generatedAt: i.generatedAt,
      rows: [],
    },
    goals: {
      cats: {
        sources: [
          {
            provider: "ozon",
            salesForecastKnown: true,
            dailyForecast: [1, 2, 3, 4, 5, 6].map((n) => ({
              date: `2026-10-0${n}`,
              units: 10,
            })),
            methodLabel: "ML",
            confidenceLabel: "Высокая",
            scenario: false,
          },
        ],
        targetUnits: 60,
        methodLabel: "ML",
        confidenceLabel: "Высокая",
        message: "",
        seasonalityApplied: true,
      },
    },
  };
}
function run() {
  return captureForecastJournal(input(), cache(), "2026-10-01T10:01:00Z");
}
function history(): ForecastHistorySeries[] {
  return ["card-a", "card-b"].flatMap((externalId) =>
    (["ordered", "cancelled"] as const).map((metric) => ({
      skuId: "cats",
      provider: "ozon" as const,
      storeId: "seller-1",
      externalId,
      metric,
      source: "ozon_fbo" as const,
      points: [1, 2, 3, 4, 5, 6].map((n) => ({
        date: `2026-10-0${n}`,
        units: metric === "ordered" ? 6 : 1,
        availability: "available" as const,
      })),
    })),
  );
}
test("journal captures immutable future quantities and stable account / mapping / pack scope", () => {
  const i = input(),
    c = cache(i),
    snapshot = captureForecastJournal(i, c, "2026-10-01T10:01:00Z");
  assert.equal(snapshot.series.length, 1);
  assert.equal(snapshot.series[0].metric, "net_ordered");
  assert.equal(snapshot.series[0].points.length, 6);
  c.goals.cats.sources![0].dailyForecast[0].units = 999;
  i.mappings[0].unitsPerItem = 999;
  assert.equal(snapshot.series[0].points[0].units, 10);
  assert.equal(snapshot.series[0].mappings[0].unitsPerItem, 2);
  assert.equal(JSON.stringify(snapshot).includes('"actual"'), false);
  const scope = forecastJournalScopes(input())[0].scopeKey;
  const reordered = input();
  reordered.mappings.reverse();
  reordered.connections[0].version = 10;
  assert.equal(forecastJournalScopes(reordered)[0].scopeKey, scope);
  const rotated = input();
  rotated.connections[0].storeId = "other-seller";
  assert.notEqual(forecastJournalScopes(rotated)[0].scopeKey, scope);
  const repacked = input();
  repacked.skus[0].unitsPerBox = 4;
  assert.notEqual(forecastJournalScopes(repacked)[0].scopeKey, scope);
  const remapped = input();
  remapped.mappings[0].unitsPerItem = 1;
  assert.notEqual(forecastJournalScopes(remapped)[0].scopeKey, scope);
  assert.throws(
    () =>
      captureForecastJournal(
        { ...input(), key: "different" },
        cache(),
        snapshot.publishedAt,
      ),
    /superseded/,
  );
  const unknown = cache();
  unknown.goals.cats.sources![0].salesForecastKnown = false;
  assert.deepEqual(
    captureForecastJournal(input(), unknown, snapshot.publishedAt).series,
    [],
  );
});
test("base and adjusted predictions are preserved independently", () => {
  const c = cache();
  Object.assign(c.goals.cats.sources![0], {
    journalBaseForecast: c.goals.cats.sources![0].dailyForecast.map((p) => ({
      ...p,
      units: 8,
    })),
  });
  const point = captureForecastJournal(input(), c, "2026-10-01T10:00:00Z")
    .series[0].points[0];
  assert.deepEqual(point, {
    date: "2026-10-01",
    baseUnits: 8,
    units: 10,
    factor: 1.25,
  });
});
test("comparison uses complete prospective days, unknown != zero, stockout excluded, distinct metrics / sellers", () => {
  const r = run(),
    facts = history();
  // Genuine known zero on day 2, missing card cancellation on day 3, stockout on day 4.
  for (const s of facts) s.points[1].units = 0;
  facts[1].points[2].units = null;
  facts[0].points[3].availability = "out_of_stock";
  const foreign = history().map((s) => ({
    ...s,
    storeId: "other-seller",
    points: s.points.map((p) => ({ ...p, units: 999 })),
  }));
  const finance = history().map((s) => ({
    ...s,
    metric: "sold" as const,
    source: "wb_finance" as const,
    points: s.points.map((p) => ({ ...p, units: 999 })),
  }));
  const before = JSON.stringify(r);
  const detail = compareForecastJournal(
    r,
    [...facts, ...foreign, ...finance],
    "2026-10-04",
  );
  assert.equal(JSON.stringify(r), before);
  assert.deepEqual(
    detail.rows[0].points.map((p) => p.status),
    ["same_day", "scored", "unknown", "stockout", "pending", "pending"],
  );
  assert.equal(detail.rows[0].points[1].actual, 0);
  assert.equal(detail.rows[0].points[2].actual, null);
  assert.equal(detail.rows[0].points[3].actual, 10);
  assert.equal(detail.rows[0].points[4].actual, null);
  assert.equal(detail.rows[0].scoredDays, 1);
  assert.equal(detail.rows[0].mae, 10);
  assert.equal(detail.rows[0].wape, null); // A zero denominator is not 0% error.
  assert.equal(detail.rows[0].bias, 10);
  assert.deepEqual(compareForecastJournal(r, facts, "2026-10-06", []).rows, []);
  assert.equal(
    journalActualPoints(r.series[0], history()).get("2026-10-02")!.actual,
    10,
  ); // Loader already applied unitsPerItem.
  const missing = history().filter((s) => s.externalId !== "card-b");
  assert.equal(
    journalActualPoints(r.series[0], missing).get("2026-10-02")!.actual,
    null,
  );
});
test("late night publication uses Moscow calendar day for prospective cutoff", () => {
  const r = run();
  r.publishedAt = "2026-10-01T22:05:00Z";
  assert.equal(
    compareForecastJournal(r, history(), "2026-10-06").rows[0].points[1].status,
    "same_day",
  );
  assert.equal(
    compareForecastJournal(r, history(), "2026-10-06").rows[0].points[2].status,
    "scored",
  );
});
test("append-only database retries, scoped bounded pagination and daily feedback vintages", async () => {
  const db = new PGlite();
  await db.waitReady;
  const tx = db as unknown as Queryable;
  try {
    await initializeForecastJournalStorage(tx);
    await initializeForecastJournalStorage(tx);
    const r = run(),
      scope = r.series[0].scopeKey;
    assert.equal(await appendForecastJournal(tx, r), true);
    const altered = structuredClone(r);
    altered.series[0].points[0].units = 999;
    assert.equal(await appendForecastJournal(tx, altered), false);
    assert.equal(
      (await readForecastJournal(tx, r.id, [scope]))!.series[0].points[0].units,
      10,
    );
    assert.equal(
      await readForecastJournal(tx, r.id, ["foreign-scope"]),
      undefined,
    );
    const second = structuredClone(r);
    second.id = "b".repeat(64);
    second.publishedAt = "2026-10-01T11:00:00Z";
    const foreign = structuredClone(second.series[0]);
    foreign.id = "foreign";
    foreign.scopeKey = "foreign-scope";
    foreign.storeId = "foreign";
    second.series.push(foreign);
    await appendForecastJournal(tx, second);
    const third = structuredClone(r);
    third.id = "c".repeat(64);
    third.publishedAt = "2026-10-02T10:00:00Z";
    await appendForecastJournal(tx, third);
    const page = await listForecastJournal(tx, {
      scopeKeys: [scope],
      limit: 1,
    });
    assert.equal(page.runs[0].id, third.id);
    assert.equal(page.nextCursor, third.id);
    const next = await listForecastJournal(tx, {
      scopeKeys: [scope],
      limit: 1,
      cursor: page.nextCursor!,
    });
    assert.equal(next.runs[0].id, second.id);
    assert.equal(next.runs[0].seriesCount, 1);
    const last = await listForecastJournal(tx, {
      scopeKeys: [scope],
      limit: 1,
      cursor: next.nextCursor!,
    });
    assert.equal(last.runs[0].id, r.id);
    assert.equal(last.nextCursor, null);
    assert.deepEqual(await listForecastJournal(tx, { scopeKeys: [] }), {
      runs: [],
      nextCursor: null,
    });
    assert.deepEqual(
      await listForecastJournal(tx, {
        scopeKeys: [scope],
        cursor: "d".repeat(64),
      }),
      { runs: [], nextCursor: null },
    );
    await assert.rejects(
      listForecastJournal(tx, { scopeKeys: [scope], limit: 51 }),
      /page size/,
    );
    assert.equal(
      (await readForecastJournal(tx, second.id, [scope]))!.series.length,
      1,
    );
    const old = structuredClone(r);
    old.id = "e".repeat(64);
    old.publishedAt = "2025-01-01T00:00:00Z";
    await appendForecastJournal(tx, old);
    const future = structuredClone(r);
    future.id = "f".repeat(64);
    future.publishedAt = "2026-10-10T00:00:00Z";
    await appendForecastJournal(tx, future);
    const feedback = await readForecastJournalFeedback(
      tx,
      [scope],
      "2026-10-03",
    );
    assert.deepEqual(
      feedback.map((v) => v.id),
      [third.id, second.id],
    );
    assert.equal(feedback[1].series.length, 1);
    assert.equal(
      (await tx.query("SELECT id FROM forecast_journal")).rows.length,
      5,
    ); // No retention deletion.
  } finally {
    await db.close();
  }
});

test("fact versions are recorded only when observed after an earlier prospective prediction", () => {
  const previous = run();
  const nextInput: ForecastJournalInput = {
    ...input(),
    key: "b".repeat(64),
    generatedAt: "2026-10-04T10:00:00Z",
    asOf: "2026-10-03",
    series: history(),
    journalRuns: [previous],
  };
  const nextCache = cache(nextInput);
  nextCache.goals.cats.sources![0].modelIdentity = "chosen-algorithms-v1";
  // October 3 has incomplete facts; older sales before our first forecast are not backfilled.
  nextInput.series![1].points[2].units = null;
  nextInput.series![0].points[1].availability = "out_of_stock";
  const snapshot = captureForecastJournal(
    nextInput,
    nextCache,
    "2026-10-04T10:01:00Z",
  );
  assert.equal(snapshot.series[0].modelIdentity, "chosen-algorithms-v1");
  assert.deepEqual(snapshot.observedActuals, [
    {
      scopeKey: previous.series[0].scopeKey,
      date: "2026-10-02",
      units: 10,
      stockout: true,
    },
  ]);
  nextInput.series![0].points[1].units = 999;
  assert.equal(snapshot.observedActuals![0].units, 10); // Later corrections cannot rewrite knowledge at this issue.
  const revised = captureForecastJournal(
    nextInput,
    nextCache,
    "2026-10-04T11:01:00Z",
  );
  assert.equal(revised.observedActuals![0].units, 1003);
  assert.deepEqual(
    captureForecastJournal(
      { ...nextInput, journalRuns: [] },
      nextCache,
      snapshot.publishedAt,
    ).observedActuals,
    [],
  );
  const otherAccount = {
    ...nextInput,
    connections: [{ provider: "ozon" as const, storeId: "different-seller" }],
  };
  assert.deepEqual(
    captureForecastJournal(otherAccount, nextCache, snapshot.publishedAt)
      .observedActuals,
    [],
  );
  // Unknown is omitted; genuine zero remains a remembered version.
  const zeroHistory = history();
  for (const s of zeroHistory) s.points[1].units = 0;
  const knownZero = captureForecastJournal(
    { ...nextInput, series: zeroHistory },
    nextCache,
    snapshot.publishedAt,
  );
  assert.equal(
    knownZero.observedActuals!.find((p) => p.date === "2026-10-02")!.units,
    0,
  );
});
