import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  initializeForecastHistoryStorage,
  archiveMarketplaceSnapshot,
  historyRows,
  historyPut,
  loadForecastHistorySeries,
} from "../src/forecasting/history-storage";
import type { Connection } from "../src/marketplaces/storage";
import type { MarketplaceSnapshot } from "../src/marketplaces/providers/types";
import type {
  HistoryFact,
  HistoryCoverage,
} from "../src/forecasting/history-types";
import type { Queryable } from "../src/database";
const c: Connection = {
  provider: "ozon",
  clientId: "seller-a",
  encrypted: "encrypted",
  enabled: true,
  version: 1,
  lastSuccessVersion: 1,
  syncStatus: "success",
  runId: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  message: null,
  warnings: [],
};
const s: MarketplaceSnapshot = {
  provider: "ozon",
  from: "2026-10-01",
  to: "2026-10-03",
  asOf: "2026-10-04T00:00:00Z",
  products: [{ externalId: "sku1", name: "Product", barcodes: [] }],
  stocks: [
    {
      externalId: "sku1",
      warehouseId: "1",
      warehouseName: "one",
      availableUnits: 0,
      reservedUnits: null,
      inboundUnits: null,
    },
  ],
  demand: [
    {
      externalId: "sku1",
      date: "2026-10-01",
      orderedUnits: 10,
      cancelledUnits: 1,
      soldUnits: null,
      returnedUnits: 0,
    },
  ],
  coverage: { catalog: true, demand: true, stocks: true, inbound: false },
  warnings: [],
};
test("history archives only full verified snapshots, retains older dates and replaces corrected aggregates idempotently", async () => {
  const db = new PGlite();
  try {
    const tx = db as unknown as Queryable;
    await tx.query(
      "CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    await initializeForecastHistoryStorage(tx);
    await tx.query(
      "CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    await initializeForecastHistoryStorage(tx);
    const conn = { ...c };
    await archiveMarketplaceSnapshot(tx, conn, s);
    const revision = (
      await tx.query<{ value: string }>(
        "SELECT value FROM metadata WHERE key='forecast_history_revision'",
      )
    ).rows[0].value;
    await archiveMarketplaceSnapshot(tx, conn, s);
    assert.equal(
      (
        await tx.query<{ value: string }>(
          "SELECT value FROM metadata WHERE key='forecast_history_revision'",
        )
      ).rows[0].value,
      revision,
    );
    let facts = await historyRows<HistoryFact>(tx, "forecast_history_facts");
    assert.equal(facts.length, 2);
    assert.ok(conn.historyStoreId);
    assert.equal(JSON.stringify(facts).includes("encrypted"), false);
    await archiveMarketplaceSnapshot(tx, conn, {
      ...s,
      from: "2026-10-02",
      to: "2026-10-03",
      demand: [],
    });
    assert.equal((await historyRows(tx, "forecast_history_facts")).length, 2);
    await archiveMarketplaceSnapshot(tx, conn, {
      ...s,
      demand: [{ ...s.demand[0], cancelledUnits: 5 }],
    });
    facts = await historyRows(tx, "forecast_history_facts");
    assert.equal(facts.find((f) => f.metric === "cancelled")?.units, 5);
    await archiveMarketplaceSnapshot(
      tx,
      { ...conn, version: 2 },
      { ...s, demand: [] },
    );
    assert.equal((await historyRows(tx, "forecast_history_facts")).length, 2);
    await archiveMarketplaceSnapshot(tx, conn, {
      ...s,
      coverage: { ...s.coverage, demand: false },
      demand: [],
    });
    assert.equal((await historyRows(tx, "forecast_history_facts")).length, 2);
    const series = await loadForecastHistorySeries(
      tx,
      [
        {
          provider: "ozon",
          externalId: "sku1",
          skuId: "theme",
          unitsPerItem: 2,
        },
      ],
      "2026-10-06",
    );
    assert.deepEqual(
      series.find((x) => x.metric === "ordered")?.points.map((p) => p.units),
      [20, 0, 0, null, null],
    );
    assert.equal(series[0].points[3].availability, "out_of_stock");
    assert.equal(series[0].points[0].availability, "unknown");
  } finally {
    await db.close();
  }
});
test("stores and metrics stay separate; partial pages are unknown and never added twice to full operational totals", async () => {
  const db = new PGlite();
  try {
    const tx = db as unknown as Queryable;
    await tx.query(
      "CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    await initializeForecastHistoryStorage(tx);
    const conn = { ...c };
    await archiveMarketplaceSnapshot(tx, conn, s);
    const event: HistoryFact = {
      id: "event",
      storeId: conn.historyStoreId!,
      provider: "ozon",
      externalId: "sku1",
      date: "2026-09-29",
      metric: "ordered",
      units: 3,
      source: "ozon_fbo",
      observedAt: s.asOf,
    };
    await historyPut(tx, "forecast_history_facts", event.id, event);
    const mapping = [
      {
        provider: "ozon" as const,
        externalId: "sku1",
        skuId: "theme",
        unitsPerItem: 1,
      },
    ];
    let series = await loadForecastHistorySeries(tx, mapping, "2026-10-04");
    assert.equal(
      series.find((x) => x.metric === "ordered")?.points[0].units,
      null,
    );
    const cov: HistoryCoverage = {
      storeId: conn.historyStoreId!,
      provider: "ozon",
      source: "ozon_fbo",
      from: "2026-09-01",
      to: "2026-10-03",
      observedAt: s.asOf,
    };
    await historyPut(tx, "forecast_history_coverage", "month", cov);
    await historyPut(tx, "forecast_history_facts", "duplicate-event", {
      ...event,
      id: "duplicate-event",
      date: "2026-10-01",
      units: 99,
    });
    series = await loadForecastHistorySeries(tx, mapping, "2026-10-04");
    assert.deepEqual(
      series.find((x) => x.metric === "ordered")?.points.map((p) => p.units),
      [3, 0, 10, 0, 0],
    );
    await archiveMarketplaceSnapshot(tx, { ...c, clientId: "seller-b" }, s);
    assert.equal(
      new Set(
        (await loadForecastHistorySeries(tx, mapping, "2026-10-04")).map(
          (x) => x.storeId,
        ),
      ).size,
      2,
    );
  } finally {
    await db.close();
  }
});
