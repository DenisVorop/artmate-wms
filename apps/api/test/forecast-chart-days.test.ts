import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Queryable } from "../src/database";
import type { ForecastJournalRun } from "../src/forecasting/journal-types";
import {
  initializeForecastChartStorage,
  appendForecastChartDays,
  readForecastChartDays,
} from "../src/forecasting/chart-history-storage";
const run = (
  publishedAt: string,
  units: number,
  date = "2026-10-28",
  historyKey = "card/orders",
): ForecastJournalRun => ({
  id: publishedAt,
  generatedAt: publishedAt,
  publishedAt,
  asOf: "2026-10-26",
  modelVersion: "v1",
  settings: {
    historyDays: 89,
    horizonDays: 56,
    safetyDays: 14,
    leadDays: 7,
    dispatchWeekday: 6,
  },
  series: [],
  charts: [
    {
      skuId: "cats",
      scopeKey: "scope",
      provider: "ozon",
      storeId: "store",
      externalId: "card",
      metric: "net_ordered",
      unitsPerItem: 1,
      historyKey,
      points: [{ date, units }],
    },
  ],
});
test("daily lookup freezes the last published forecast before target Moscow day, independently per metric", async () => {
  const db = new PGlite();
  await db.waitReady;
  const tx = db as unknown as Queryable;
  try {
    await initializeForecastChartStorage(tx);
    await appendForecastChartDays(tx, run("2026-10-27T09:00:00Z", 10));
    await appendForecastChartDays(tx, run("2026-10-27T20:59:59Z", 12));
    await appendForecastChartDays(tx, run("2026-10-27T08:00:00Z", 8));
    await appendForecastChartDays(tx, run("2026-10-27T21:00:00Z", 99)); // 28th in Moscow: already too late
    await appendForecastChartDays(tx, run("2026-10-28T10:00:00Z", 88));
    await appendForecastChartDays(
      tx,
      run("2026-10-27T10:00:00Z", 2, "2026-10-28", "card/sold"),
    );
    assert.deepEqual(
      await readForecastChartDays(tx, ["card/orders"], "2026-10-28"),
      [
        {
          historyKey: "card/orders",
          date: "2026-10-28",
          units: 12,
          publishedAt: "2026-10-27T20:59:59Z",
        },
      ],
    );
    assert.equal(
      (await readForecastChartDays(tx, ["card/sold"], "2026-10-28"))[0].units,
      2,
    );
    assert.deepEqual(
      await readForecastChartDays(tx, ["other-account"], "2026-10-28"),
      [],
    );
    assert.deepEqual(
      await readForecastChartDays(tx, ["card/orders"], "2026-10-27"),
      [],
    );
    assert.deepEqual(await readForecastChartDays(tx, [], "2026-10-28"), []);
    await assert.rejects(
      appendForecastChartDays(tx, run("2026-10-27T10:00:00Z", -1)),
      /Invalid/,
    );
    assert.equal(
      (await readForecastChartDays(tx, ["card/orders"], "2026-10-28"))[0].units,
      12,
    );
  } finally {
    await db.close();
  }
});
