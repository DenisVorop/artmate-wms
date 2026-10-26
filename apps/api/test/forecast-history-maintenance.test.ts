import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  initializeMarketplaceStorage,
  put,
  type Connection,
} from "../src/marketplaces/storage";
import {
  initializeForecastHistoryStorage,
  historyPut,
  loadHistoryJobs,
} from "../src/forecasting/history-storage";
import { ForecastHistoryService } from "../src/forecasting/history.service";
import { MarketplaceSecrets } from "../src/marketplaces/secrets";
import type { WarehouseService } from "../src/warehouse.service";
import type { Queryable } from "../src/database";
import type { HistoryJob } from "../src/forecasting/history-types";
import { requestAuth } from "../src/auth-context";
const connection: Connection = {
  provider: "ozon",
  clientId: "seller-a",
  encrypted: "opaque",
  enabled: true,
  version: 1,
  historyStoreId: "store-a",
  syncStatus: "success",
  lastAttemptAt: "2026-10-26T08:00:00Z",
  lastSuccessAt: "2026-10-26T08:00:00Z",
  message: null,
  warnings: [],
  runId: null,
};
const job: HistoryJob = {
  id: "initial",
  provider: "ozon",
  storeId: "store-a",
  connectionVersion: 1,
  from: "2024-01-29",
  to: "2026-10-24",
  monthFrom: "2026-10-01",
  monthTo: "2026-10-24",
  cursor: "",
  seenCursors: [],
  pages: 30,
  status: "complete",
  leaseId: null,
  leaseUntil: null,
  retryAt: null,
  message: "",
  createdAt: "2026-10-24T08:00:00Z",
  updatedAt: "2026-10-25T08:00:00Z",
};
test("ongoing history only follows explicitly authorized completed stores, is bounded daily and preserves permission/account boundaries", async (t) => {
  const db = new PGlite(),
    tx = db as unknown as Queryable,
    realNow = Date.now;
  Date.now = () => Date.parse("2026-10-26T08:00:00Z");
  try {
    await tx.query(
      "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    await initializeMarketplaceStorage(tx);
    await initializeForecastHistoryStorage(tx);
    const warehouse = {
      authTransaction: <T>(fn: (tx: Queryable) => Promise<T>) =>
        db.transaction((q) => fn(q as unknown as Queryable)),
    } as unknown as WarehouseService;
    const service = ForecastHistoryService.forTesting(
      warehouse,
      new MarketplaceSecrets({ key: Buffer.alloc(32).toString("base64") }),
      async () => ({ facts: [], cursor: null }),
    );
    const reset = async (c: Connection = connection) => {
      await tx.query("DELETE FROM forecast_history_jobs");
      await tx.query("DELETE FROM marketplace_connections");
      await put(tx, "marketplace_connections", c.provider, c);
    };
    await t.test(
      "no explicit authorization means no automatic historical requests",
      async () => {
        await reset();
        assert.equal(await service.maintainAuthorizedHistory(), 0);
        assert.equal((await loadHistoryJobs(tx)).length, 0);
        await assert.rejects(
          requestAuth.run(
            { http: true, tokenHash: null, csrfToken: null, origin: null },
            () => service.maintainAuthorizedHistory(),
          ),
        );
      },
    );
    await t.test(
      "the next day queues one rolling60day repair job and reuses it across scheduler restarts",
      async () => {
        await reset();
        await historyPut(tx, "forecast_history_jobs", job.id, job);
        assert.equal(await service.maintainAuthorizedHistory(), 1);
        const jobs = await loadHistoryJobs(tx),
          repair = jobs.find((j) => j.id !== job.id)!;
        assert.equal(repair.from, "2026-08-27");
        assert.equal(repair.to, "2026-10-25");
        assert.equal(repair.status, "queued");
        assert.equal(
          (repair as HistoryJob & { parentJobId: string }).parentJobId,
          job.id,
        );
        assert.equal(await service.maintainAuthorizedHistory(), 0);
        const restarted = ForecastHistoryService.forTesting(
          warehouse,
          new MarketplaceSecrets({ key: Buffer.alloc(32).toString("base64") }),
          async () => ({ facts: [], cursor: null }),
        );
        assert.equal(await restarted.maintainAuthorizedHistory(), 0);
        assert.equal((await loadHistoryJobs(tx)).length, 2);
      },
    );
    await t.test(
      "same-day completion needs no immediate duplicate repair",
      async () => {
        await reset();
        await historyPut(tx, "forecast_history_jobs", job.id, {
          ...job,
          to: "2026-10-25",
          updatedAt: "2026-10-26T06:00:00Z",
        });
        assert.equal(await service.maintainAuthorizedHistory(), 0);
      },
    );
    await t.test(
      "pending backfill, paused work and permission gates are never bypassed by a maintenance job",
      async () => {
        for (const status of [
          "queued",
          "running",
          "paused",
          "permission_required",
          "failed",
        ] as const) {
          await reset();
          await historyPut(tx, "forecast_history_jobs", job.id, job);
          await historyPut(tx, "forecast_history_jobs", "blocked", {
            ...job,
            id: "blocked",
            status,
          });
          assert.equal(await service.maintainAuthorizedHistory(), 0);
        }
      },
    );
    await t.test(
      "new seller identity and disabled store never inherit authorization",
      async () => {
        for (const patch of [
          { historyStoreId: "store-b" },
          { enabled: false },
        ]) {
          await reset({ ...connection, ...patch });
          await historyPut(tx, "forecast_history_jobs", job.id, job);
          assert.equal(await service.maintainAuthorizedHistory(), 0);
        }
      },
    );
    await t.test(
      "a long shutdown catches up its entire gap, rather than silently skipping days older than60",
      async () => {
        await reset();
        await historyPut(tx, "forecast_history_jobs", job.id, {
          ...job,
          to: "2026-03-01",
        });
        assert.equal(await service.maintainAuthorizedHistory(), 1);
        const repair = (await loadHistoryJobs(tx)).find(
          (j) => j.id !== job.id,
        )!;
        assert.equal(repair.from, "2026-03-02");
        assert.equal(repair.to, "2026-10-25");
      },
    );
    await t.test(
      "WB ongoing financial history requires both separate credentials and verified seller identity",
      async () => {
        for (const finance of [
          {},
          { financeEncrypted: "opaque" },
          { financeEncrypted: "opaque", historySellerId: "verified-seller" },
        ]) {
          await reset({
            ...connection,
            provider: "wildberries",
            clientId: null,
            ...finance,
          });
          await historyPut(tx, "forecast_history_jobs", job.id, {
            ...job,
            provider: "wildberries",
          });
          assert.equal(
            await service.maintainAuthorizedHistory(),
            "historySellerId" in finance ? 1 : 0,
          );
        }
      },
    );
    const revision = (
      await tx.query<{ value: string }>(
        "SELECT value FROM metadata WHERE key='forecast_history_revision'",
      )
    ).rows[0].value;
    assert.equal(revision, "0");
  } finally {
    Date.now = realNow;
    await db.close();
  }
});
