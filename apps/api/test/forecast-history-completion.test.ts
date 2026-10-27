import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Queryable } from "../src/database";
import type { WarehouseService } from "../src/warehouse.service";
import { ForecastHistoryService } from "../src/forecasting/history.service";
import {
  initializeForecastHistoryStorage,
  historyPut,
  historyRows,
  loadHistoryJobs,
  loadForecastHistorySeries,
} from "../src/forecasting/history-storage";
import {
  initializeMarketplaceStorage,
  put,
  type Connection,
} from "../src/marketplaces/storage";
import { MarketplaceSecrets } from "../src/marketplaces/secrets";
import type {
  HistoryCoverage,
  HistoryJob,
} from "../src/forecasting/history-types";

test("archive resumption, report-window repair and invalid-page failures preserve published facts", async (t) => {
  const db = new PGlite(),
    tx = db as unknown as Queryable,
    realNow = Date.now;
  let now = Date.parse("2026-10-27T10:10:00Z");
  Date.now = () => now;
  try {
    await tx.query(
      "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    await initializeMarketplaceStorage(tx);
    await initializeForecastHistoryStorage(tx);
    const secrets = new MarketplaceSecrets({
      key: Buffer.alloc(32).toString("base64"),
    });
    const warehouse = {
      authTransaction: <T>(fn: (tx: Queryable) => Promise<T>) =>
        db.transaction((q) => fn(q as unknown as Queryable)),
    } as unknown as WarehouseService;
    const connection: Connection = {
      provider: "ozon",
      clientId: "seller",
      encrypted: await secrets.encrypt(
        { apiKey: "fixture", clientId: "seller" },
        "ozon",
      ),
      enabled: true,
      version: 1,
      historyStoreId: "ozon-store",
      syncStatus: "success",
      lastAttemptAt: new Date(now).toISOString(),
      lastSuccessAt: new Date(now).toISOString(),
      message: null,
      warnings: [],
      runId: null,
    };
    const job: HistoryJob = {
      id: "archive",
      provider: "ozon",
      storeId: "ozon-store",
      connectionVersion: 1,
      from: "2026-01-01",
      to: "2026-02-28",
      monthFrom: "2026-02-01",
      monthTo: "2026-02-28",
      cursor: "expired",
      seenCursors: ["expired"],
      pages: 2,
      status: "failed",
      leaseId: null,
      leaseUntil: null,
      retryAt: null,
      message: "",
      createdAt: new Date(now - 86400000).toISOString(),
      updatedAt: new Date(now - 86400000).toISOString(),
    };
    const reset = async () => {
      for (const table of [
        "forecast_history_jobs",
        "forecast_history_facts",
        "forecast_history_pages",
        "forecast_history_coverage",
        "marketplace_connections",
      ])
        await tx.query(`DELETE FROM ${table}`);
      await put(tx, "marketplace_connections", "ozon", connection);
    };
    await t.test(
      "three failures restart only the unpublished cursor month, keeping other jobs and published history",
      async () => {
        await reset();
        await historyPut(tx, "forecast_history_jobs", job.id, job);
        await historyPut(tx, "forecast_history_pages", "staged", {
          jobId: job.id,
          monthFrom: job.monthFrom,
          facts: [],
        });
        await historyPut(tx, "forecast_history_pages", "other-month", {
          jobId: job.id,
          monthFrom: "2026-01-01",
          facts: [],
        });
        await historyPut(tx, "forecast_history_facts", "published", {
          id: "published",
          storeId: job.storeId,
          provider: "ozon",
          externalId: "book",
          date: "2026-01-20",
          metric: "ordered",
          units: 7,
          source: "ozon_fbo",
          observedAt: new Date(now).toISOString(),
        });
        const service = ForecastHistoryService.forTesting(
          warehouse,
          secrets,
          async () => {
            throw new Error("private upstream body");
          },
        );
        for (let attempt = 0; attempt < 3; attempt++) {
          await put(tx, "marketplace_connections", "ozon", {
            ...connection,
            lastAttemptAt: new Date(now).toISOString(),
          });
          assert.equal(await service.runNextHistoryPage(), "failed");
          const current = (await loadHistoryJobs(tx))[0];
          assert.ok(current.retryAt);
          assert.equal(JSON.stringify(current).includes("private"), false);
          now = Date.parse(current.retryAt!) + 1;
        }
        const current = (await loadHistoryJobs(tx))[0];
        assert.equal(current.cursor, "");
        assert.deepEqual(current.seenCursors, []);
        assert.equal(current.cursorRestarts, 1);
        assert.equal(
          (await historyRows(tx, "forecast_history_pages")).length,
          1,
        );
        assert.equal(
          (await historyRows(tx, "forecast_history_facts")).length,
          1,
        );
      },
    );
    await t.test(
      "invalid payload is persisted as failed instead of leaving a running lease until timeout",
      async () => {
        await reset();
        now = Date.parse("2026-10-27T10:10:00Z");
        await historyPut(tx, "forecast_history_jobs", job.id, job);
        const service = ForecastHistoryService.forTesting(
          warehouse,
          secrets,
          async () => ({
            facts: [
              {
                id: "bad",
                externalId: "book",
                date: "2027-01-01",
                metric: "ordered",
                units: 1,
                source: "ozon_fbo",
              },
            ],
            cursor: null,
          }),
        );
        assert.equal(await service.runNextHistoryPage(), "failed");
        const current = (await loadHistoryJobs(tx))[0];
        assert.equal(current.leaseId, null);
        assert.equal(current.leaseUntil, null);
        assert.equal(current.cursor, "expired");
        assert.equal(
          (await historyRows(tx, "forecast_history_facts")).length,
          0,
        );
      },
    );
    await t.test(
      "bootstrap repairs proven financial report windows without creating sale-date zeros or claiming partial months",
      async () => {
        await reset();
        await put(tx, "marketplace_connections", "wildberries", {
          ...connection,
          provider: "wildberries",
          historyStoreId: "wb-store",
        });
        await historyPut(tx, "forecast_history_jobs", job.id, {
          ...job,
          provider: "wildberries",
          storeId: "wb-store",
          from: "2026-01-29",
          monthFrom: "2026-02-01",
          status: "queued",
        });
        await historyPut(tx, "forecast_history_facts", "finance", {
          id: "finance",
          storeId: "wb-store",
          provider: "wildberries",
          externalId: "book",
          date: "2026-01-30",
          metric: "sold",
          units: 3,
          source: "wb_finance",
          observedAt: new Date(now).toISOString(),
        });
        const service = ForecastHistoryService.forTesting(
          warehouse,
          secrets,
          async () => ({ facts: [], cursor: null }),
        );
        await service.bootstrap();
        await service.bootstrap();
        const coverage = await historyRows<HistoryCoverage>(
          tx,
          "forecast_history_coverage",
        );
        assert.equal(coverage.length, 1);
        assert.equal(coverage[0].from, "2026-01-29");
        assert.equal(coverage[0].to, "2026-01-31");
        assert.equal(coverage[0].scope, "report_window");
        const [series] = await loadForecastHistorySeries(
          tx,
          [
            {
              provider: "wildberries",
              externalId: "book",
              skuId: "sku",
              unitsPerItem: 1,
            },
          ],
          "2026-02-03",
        );
        assert.deepEqual(
          series.points.map((p) => p.units),
          [3, null, null, null],
        );
      },
    );
    await t.test(
      "cross-month Ozon creation dates retain retrieval ownership and do not become query-window zeros",
      async () => {
        await reset();
        now = Date.parse("2026-10-27T10:10:00Z");
        await historyPut(tx, "forecast_history_jobs", job.id, job);
        const service = ForecastHistoryService.forTesting(
          warehouse,
          secrets,
          async () => ({
            facts: [
              {
                id: "cross",
                externalId: "book",
                date: "2026-01-29",
                metric: "ordered",
                units: 2,
                source: "ozon_fbo",
              },
            ],
            cursor: null,
          }),
        );
        assert.equal(await service.runNextHistoryPage(), "complete");
        const facts = await historyRows<{
          date: string;
          windowFrom: string;
          windowTo: string;
        }>(tx, "forecast_history_facts");
        assert.equal(facts[0].date, "2026-01-29");
        assert.equal(facts[0].windowFrom, "2026-02-01");
        const [series] = await loadForecastHistorySeries(
          tx,
          [
            {
              provider: "ozon",
              externalId: "book",
              skuId: "sku",
              unitsPerItem: 1,
            },
          ],
          "2026-03-01",
        );
        assert.equal(
          series.points.find((p) => p.date === "2026-01-29")?.units,
          2,
        );
        assert.equal(
          series.points.find((p) => p.date === "2026-02-10")?.units,
          null,
        );
      },
    );
    await t.test(
      "an expanded Ozon month replaces contained prior windows and preserves other or larger windows regardless of creation date",
      async () => {
        await reset();
        now = Date.parse("2026-10-27T10:10:00Z");
        await historyPut(tx, "forecast_history_jobs", job.id, job);
        const base = {
          storeId: job.storeId,
          provider: "ozon",
          externalId: "book",
          date: "2026-01-29",
          metric: "ordered",
          units: 1,
          source: "ozon_fbo",
          observedAt: new Date(now).toISOString(),
          windowFrom: "2026-02-01",
          windowTo: "2026-02-20",
        };
        await historyPut(tx, "forecast_history_facts", "gone", {
          ...base,
          id: "gone",
        });
        await historyPut(tx, "forecast_history_facts", "larger", {
          ...base,
          id: "larger",
          windowTo: "2026-03-31",
        });
        await historyPut(tx, "forecast_history_facts", "other-window", {
          ...base,
          id: "other-window",
          date: "2026-02-10",
          windowFrom: "2026-01-01",
          windowTo: "2026-01-31",
        });
        const service = ForecastHistoryService.forTesting(
          warehouse,
          secrets,
          async () => ({ facts: [], cursor: null }),
        );
        assert.equal(await service.runNextHistoryPage(), "complete");
        const ids = (
          await historyRows<{ id: string }>(tx, "forecast_history_facts")
        )
          .map((f) => f.id)
          .sort();
        assert.deepEqual(ids, ["larger", "other-window"]);
      },
    );
    await t.test(
      "only a completed gap-free financial archive supplies mature zero sale days from product appearance",
      async () => {
        await reset();
        await put(tx, "marketplace_connections", "wildberries", {
          ...connection,
          provider: "wildberries",
          historyStoreId: "wb-store",
        });
        await historyPut(tx, "forecast_history_jobs", job.id, {
          ...job,
          provider: "wildberries",
          storeId: "wb-store",
          from: "2026-01-29",
          monthFrom: "2026-02-01",
          status: "complete",
        });
        await historyPut(tx, "forecast_history_facts", "finance", {
          id: "finance",
          storeId: "wb-store",
          provider: "wildberries",
          externalId: "book",
          date: "2026-01-30",
          metric: "sold",
          units: 3,
          source: "wb_finance",
          observedAt: new Date(now).toISOString(),
        });
        const service = ForecastHistoryService.forTesting(
          warehouse,
          secrets,
          async () => ({ facts: [], cursor: null }),
        );
        await service.bootstrap();
        const series = await loadForecastHistorySeries(
            tx,
            [
              {
                provider: "wildberries",
                externalId: "book",
                skuId: "sku",
                unitsPerItem: 1,
              },
            ],
            "2026-03-03",
          ),
          sold = series.find((s) => s.metric === "sold")!,
          returned = series.find((s) => s.metric === "returned")!;
        assert.equal(sold.points[0].date, "2026-01-30");
        assert.equal(
          sold.points.find((p) => p.date === "2026-01-31")?.units,
          0,
        );
        assert.equal(
          sold.points.find((p) => p.date === "2026-02-22")?.units,
          0,
        );
        assert.equal(
          sold.points.find((p) => p.date === "2026-02-23")?.units,
          null,
        );
        assert.equal(
          returned.points.find((p) => p.date === "2026-01-31")?.units,
          0,
        );
        assert.ok(sold.points.every((p) => p.availability === "unknown"));
        await tx.query(
          "DELETE FROM forecast_history_coverage WHERE payload->>'from'='2026-01-29'",
        );
        const [incomplete] = await loadForecastHistorySeries(
          tx,
          [
            {
              provider: "wildberries",
              externalId: "book",
              skuId: "sku",
              unitsPerItem: 1,
            },
          ],
          "2026-03-03",
        );
        assert.equal(
          incomplete.points.find((p) => p.date === "2026-01-31")?.units,
          null,
        );
      },
    );
  } finally {
    Date.now = realNow;
    await db.close();
  }
});
