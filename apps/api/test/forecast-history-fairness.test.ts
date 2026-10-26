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
  loadHistoryJobs,
} from "../src/forecasting/history-storage";
import {
  initializeMarketplaceStorage,
  put,
  type Connection,
} from "../src/marketplaces/storage";
import { MarketplaceSecrets } from "../src/marketplaces/secrets";
import type { HistoryJob } from "../src/forecasting/history-types";
test("historical pages fairly alternate waiting stores while preserving backfill priority, leases and WB cooldown", async () => {
  const db = new PGlite(),
    tx = db as unknown as Queryable,
    realNow = Date.now;
  let now = Date.parse("2026-10-26T08:10:00Z");
  Date.now = () => now;
  try {
    await tx.query(
      "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    await initializeMarketplaceStorage(tx);
    await initializeForecastHistoryStorage(tx);
    const secrets = new MarketplaceSecrets({
        key: Buffer.alloc(32).toString("base64"),
      }),
      warehouse = {
        authTransaction: <T>(fn: (tx: Queryable) => Promise<T>) =>
          db.transaction((q) => fn(q as unknown as Queryable)),
      } as unknown as WarehouseService;
    for (const provider of ["ozon", "wildberries"] as const) {
      const c: Connection = {
        provider,
        clientId: provider === "ozon" ? "seller" : null,
        encrypted: await secrets.encrypt(
          { apiKey: "operational", clientId: "seller" },
          provider,
        ),
        enabled: true,
        version: 1,
        historyStoreId: provider,
        syncStatus: "success",
        lastAttemptAt: new Date(now).toISOString(),
        lastSuccessAt: new Date(now).toISOString(),
        message: null,
        warnings: [],
        runId: null,
        ...(provider === "wildberries"
          ? {
              financeEncrypted: await secrets.encrypt(
                { apiKey: "finance" },
                `forecast-finance:${provider}`,
              ),
              historySellerId: "verified",
            }
          : {}),
      };
      await put(tx, "marketplace_connections", provider, c);
    }
    const makeJob = (
      id: string,
      provider: "ozon" | "wildberries",
      updatedAt: string,
    ): HistoryJob => ({
      id,
      provider,
      storeId: provider,
      connectionVersion: 1,
      from: "2024-01-29",
      to: "2026-10-25",
      monthFrom: "2024-01-29",
      monthTo: "2024-01-31",
      cursor: "",
      seenCursors: [],
      pages: 0,
      status: "queued",
      leaseId: null,
      leaseUntil: null,
      retryAt: null,
      message: "",
      createdAt: updatedAt,
      updatedAt,
    });
    await historyPut(
      tx,
      "forecast_history_jobs",
      "a-ozon",
      makeJob("a-ozon", "ozon", "2026-10-25T06:00:00Z"),
    );
    await historyPut(
      tx,
      "forecast_history_jobs",
      "b-wb",
      makeJob("b-wb", "wildberries", "2026-10-25T07:00:00Z"),
    );
    // A much older maintenance job must still wait for either explicit backfill.
    await historyPut(tx, "forecast_history_jobs", "maintenance", {
      ...makeJob("maintenance", "ozon", "2026-01-01T00:00:00Z"),
      maintenanceDay: "2026-10-25",
    });
    const calls: string[] = [];
    let active = 0,
      maxActive = 0;
    let release: () => void = () => {};
    let block = false;
    const fetchPage = async (_credentials: unknown, j: HistoryJob) => {
      calls.push(j.id);
      active++;
      maxActive = Math.max(active, maxActive);
      try {
        if (block)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return { facts: [], cursor: `cursor-${j.pages + 1}` };
      } finally {
        active--;
      }
    };
    const service = ForecastHistoryService.forTesting(
      warehouse,
      secrets,
      fetchPage,
      fetchPage,
    );
    assert.equal(await service.runNextHistoryPage(), "queued");
    assert.equal(await service.runNextHistoryPage(), "queued");
    assert.deepEqual(calls, ["a-ozon", "b-wb"]);
    const wb = (await loadHistoryJobs(tx)).find((j) => j.id === "b-wb")!;
    assert.equal(wb.pages, 1);
    assert.equal(Date.parse(wb.retryAt!), now + 61000);
    assert.equal(await service.runNextHistoryPage(), "queued");
    assert.equal(calls.at(-1), "a-ozon");
    // Give Ozon a newer timestamp, then only WB is eligible after the exact persisted cooldown.
    await historyPut(tx, "forecast_history_jobs", "a-ozon", {
      ...(await loadHistoryJobs(tx)).find((j) => j.id === "a-ozon")!,
      updatedAt: "2099-01-01T00:00:00Z",
    });
    now += 61000;
    assert.equal(await service.runNextHistoryPage(), "queued");
    assert.equal(calls.at(-1), "b-wb");
    // A pending provider request is never joined by another page for that same store.
    block = true;
    const pending = service.runNextHistoryPage();
    while (!active) await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(await service.runNextHistoryPage(), "skipped");
    release();
    await pending;
    assert.equal(maxActive, 1);
    assert.equal(calls.includes("maintenance"), false);
    assert.equal(
      (await loadHistoryJobs(tx)).find((j) => j.id === "maintenance")?.pages,
      0,
    );
  } finally {
    Date.now = realNow;
    await db.close();
  }
});
