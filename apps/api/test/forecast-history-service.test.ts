import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WarehouseService } from "../src/warehouse.service";
import { ForecastHistoryService } from "../src/forecasting/history.service";
import {
  initializeForecastHistoryStorage,
  historyRows,
  historyPut,
  loadHistoryJobs,
} from "../src/forecasting/history-storage";
import { MarketplaceSecrets } from "../src/marketplaces/secrets";
import {
  loadMarketplaces,
  put,
  type Connection,
} from "../src/marketplaces/storage";
import { requestAuth } from "../src/auth-context";
import type { HistoryFact, HistoryJob } from "../src/forecasting/history-types";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
test("durable history pages have auth, replay, lease, atomic cursor and account guards without warehouse side effects", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "wms-forecast-")),
    prev = process.env.WMS_DATA_DIR,
    realNow = Date.now;
  process.env.WMS_DATA_DIR = join(dir, "db");
  Date.now = () => Math.floor(realNow() / 1800000) * 1800000 + 600000;
  const w = new WarehouseService(),
    secrets = new MarketplaceSecrets({ path: join(dir, "key") });
  try {
    await w.snapshot();
    await w.authTransaction(async (tx) => {
      await initializeForecastHistoryStorage(tx);
      await tx.query(
        "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES('history-manager','employee-3','history-manager','test-only','manager',FALSE),('history-worker','employee-1','history-worker','test-only','employee',FALSE)",
      );
      await tx.query(
        "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES('history-manager','history-manager','history-manager','csrf',NOW()+INTERVAL '1 hour'),('history-worker','history-worker','history-worker','csrf',NOW()+INTERVAL '1 hour')",
      );
    });
    const manager = <T>(
      fn: () => T,
      csrf = "csrf",
      token = "history-manager",
    ) =>
      requestAuth.run(
        {
          http: true,
          tokenHash: token,
          csrfToken: csrf,
          origin: "http://127.0.0.1:3080",
        },
        fn,
      );
    const connection: Connection = {
      provider: "ozon",
      clientId: "seller",
      encrypted: await secrets.encrypt(
        { apiKey: "test-secret", clientId: "seller" },
        "ozon",
      ),
      enabled: true,
      version: 1,
      syncStatus: "success",
      lastAttemptAt: new Date(Date.now()).toISOString(),
      lastSuccessAt: new Date().toISOString(),
      runId: null,
      message: null,
      warnings: [],
      historyStoreId: "ozon:known-store",
    };
    const setup = async () =>
      w.authTransaction(async (tx) => {
        await put(tx, "marketplace_connections", "ozon", connection);
        await tx.query("DELETE FROM forecast_history_jobs");
        await tx.query("DELETE FROM forecast_history_facts");
        await tx.query("DELETE FROM forecast_history_pages");
        await tx.query("DELETE FROM forecast_history_coverage");
      });
    const start = () => ({
      requestId: randomUUID(),
      provider: "ozon" as const,
      from: "2024-01-01",
      to: "2024-01-31",
    });
    const read = () => w.authTransaction((tx) => loadHistoryJobs(tx));
    const before = await w.snapshot();
    await t.test(
      "manager, CSRF and replay validation; background methods cannot run in HTTP",
      async () => {
        await setup();
        const s = ForecastHistoryService.forTesting(w, secrets, async () => ({
          facts: [],
          cursor: null,
        }));
        await assert.rejects(s.getForecastHistory());
        await assert.rejects(
          manager(() => s.startForecastHistory(start()), "wrong"),
        );
        await assert.rejects(
          manager(
            () => s.startForecastHistory(start()),
            "csrf",
            "history-worker",
          ),
        );
        const b = start(),
          first = await manager(() => s.startForecastHistory(b));
        assert.deepEqual(await manager(() => s.startForecastHistory(b)), first);
        await assert.rejects(
          manager(() => s.startForecastHistory({ ...b, to: "2024-01-30" })),
        );
        await assert.rejects(manager(() => s.runNextHistoryPage()));
        assert.equal((await read()).length, 1);
      },
    );
    await t.test(
      "page claim is durable across service instances, concurrent import is skipped, cursor and facts commit together",
      async () => {
        await setup();
        const page = deferred<{ facts: []; cursor: string | null }>(),
          entered = deferred<void>();
        const s = ForecastHistoryService.forTesting(w, secrets, async () => {
          entered.resolve();
          return page.promise;
        });
        await manager(() => s.startForecastHistory(start()));
        const running = s.runNextHistoryPage();
        await entered.promise;
        assert.equal(await s.runNextHistoryPage(), "skipped");
        const leased = (await read())[0];
        assert.equal(leased.status, "running");
        const current = await w.authTransaction((tx) => loadMarketplaces(tx));
        assert.equal(current.connections[0].syncStatus, "success");
        assert.equal(current.connections[0].runId, null);
        page.resolve({ facts: [], cursor: "next" });
        assert.equal(await running, "queued");
        assert.equal((await read())[0].cursor, "next");
        const restarted = ForecastHistoryService.forTesting(
          w,
          secrets,
          async () => ({
            facts: [
              {
                id: "order1",
                externalId: "sku",
                date: "2024-01-02",
                metric: "ordered",
                units: 3,
                source: "ozon_fbo",
              },
            ],
            cursor: null,
          }),
        );
        assert.equal(await restarted.runNextHistoryPage(), "complete");
        assert.equal((await read())[0].pages, 2);
        assert.equal(await restarted.runNextHistoryPage(), "skipped");
        assert.equal(
          (
            await w.authTransaction((tx) =>
              historyRows(tx, "forecast_history_facts"),
            )
          ).length,
          1,
        );
        assert.equal(
          (
            await w.authTransaction((tx) =>
              historyRows(tx, "forecast_history_coverage"),
            )
          ).length,
          1,
        );
      },
    );
    await t.test(
      "connection replacement discards late data and releases own lease",
      async () => {
        await setup();
        const page = deferred<{ facts: []; cursor: null }>(),
          entered = deferred<void>();
        const s = ForecastHistoryService.forTesting(w, secrets, async () => {
          entered.resolve();
          return page.promise;
        });
        await manager(() => s.startForecastHistory(start()));
        const pending = s.runNextHistoryPage();
        await entered.promise;
        await w.authTransaction(async (tx) => {
          const c = (await loadMarketplaces(tx)).connections[0];
          c.version++;
          await put(tx, "marketplace_connections", c.provider, c);
        });
        page.resolve({ facts: [], cursor: null });
        assert.equal(await pending, "paused");
        assert.equal(
          (
            await w.authTransaction((tx) =>
              historyRows(tx, "forecast_history_coverage"),
            )
          ).length,
          0,
        );
        assert.equal(
          (await w.authTransaction((tx) => loadMarketplaces(tx))).connections[0]
            .historyLease,
          undefined,
        );
      },
    );
    await t.test(
      "shutdown does not publish a late page; transient errors preserve cursor and safe retry",
      async () => {
        await setup();
        const page = deferred<{ facts: []; cursor: null }>(),
          entered = deferred<void>(),
          controller = new AbortController();
        const s = ForecastHistoryService.forTesting(w, secrets, async () => {
          entered.resolve();
          return page.promise;
        });
        await manager(() => s.startForecastHistory(start()));
        const pending = s.runNextHistoryPage(controller.signal);
        await entered.promise;
        controller.abort();
        page.resolve({ facts: [], cursor: null });
        assert.equal(await pending, "queued");
        assert.equal(
          (
            await w.authTransaction((tx) =>
              historyRows(tx, "forecast_history_coverage"),
            )
          ).length,
          0,
        );
        const failing = ForecastHistoryService.forTesting(
          w,
          secrets,
          async () => {
            throw new Error("private-secret-upstream");
          },
        );
        assert.equal(await failing.runNextHistoryPage(), "failed");
        const job = (await read())[0];
        assert.equal(job.cursor, "");
        assert.equal(JSON.stringify(job).includes("private-secret"), false);
        assert.ok(job.retryAt);
        await manager(() => failing.startForecastHistory(start()));
        const resumed = (await read())[0];
        assert.equal(resumed.status, "queued");
        assert.equal(resumed.retryAt, null);
        assert.equal(resumed.cursor, job.cursor);
      },
    );
    await t.test(
      "partial pages stay staged even when old month coverage already exists; paused jobs resume",
      async () => {
        await setup();
        const event = {
          id: "new-event",
          externalId: "sku",
          date: "2024-01-02",
          metric: "ordered" as const,
          units: 3,
          source: "ozon_fbo" as const,
        };
        const first = ForecastHistoryService.forTesting(
          w,
          secrets,
          async () => ({ facts: [event], cursor: "page2" }),
        );
        const body = start();
        await manager(() => first.startForecastHistory(body));
        await w.authTransaction(async (tx) => {
          await historyPut(tx, "forecast_history_coverage", "prior-month", {
            storeId: connection.historyStoreId,
            provider: "ozon",
            from: body.from,
            to: body.to,
            source: "ozon_fbo",
            observedAt: new Date().toISOString(),
          });
        });
        const revision = await w.authTransaction(
          async (tx) =>
            (
              await tx.query<{ value: string }>(
                "SELECT value FROM metadata WHERE key='forecast_history_revision'",
              )
            ).rows[0].value,
        );
        assert.equal(await first.runNextHistoryPage(), "queued");
        assert.equal(
          await w.authTransaction(
            async (tx) =>
              (
                await tx.query<{ value: string }>(
                  "SELECT value FROM metadata WHERE key='forecast_history_revision'",
                )
              ).rows[0].value,
          ),
          revision,
        );
        assert.equal(
          (
            await w.authTransaction((tx) =>
              historyRows(tx, "forecast_history_facts"),
            )
          ).length,
          0,
        );
        assert.equal(
          (
            await w.authTransaction((tx) =>
              historyRows(tx, "forecast_history_pages"),
            )
          ).length,
          1,
        );
        await w.authTransaction(async (tx) => {
          const j = (await loadHistoryJobs(tx))[0];
          j.status = "paused";
          await historyPut(tx, "forecast_history_jobs", j.id, j);
        });
        await manager(() =>
          first.startForecastHistory({ ...body, requestId: randomUUID() }),
        );
        assert.equal((await read())[0].status, "queued");
        const next = ForecastHistoryService.forTesting(
          w,
          secrets,
          async () => ({ facts: [], cursor: null }),
        );
        assert.equal(await next.runNextHistoryPage(), "complete");
        assert.notEqual(
          await w.authTransaction(
            async (tx) =>
              (
                await tx.query<{ value: string }>(
                  "SELECT value FROM metadata WHERE key='forecast_history_revision'",
                )
              ).rows[0].value,
          ),
          revision,
        );
        assert.equal(
          (
            await w.authTransaction((tx) =>
              historyRows(tx, "forecast_history_facts"),
            )
          ).length,
          1,
        );
        assert.equal(
          (
            await w.authTransaction((tx) =>
              historyRows(tx, "forecast_history_pages"),
            )
          ).length,
          0,
        );
      },
    );
    await t.test(
      "completed Ozon replacement removes disappeared postings only in its own source, store and month",
      async () => {
        await setup();
        const base: HistoryFact = {
          id: "removed",
          storeId: connection.historyStoreId!,
          provider: "ozon",
          externalId: "sku",
          date: "2024-01-02",
          metric: "ordered",
          units: 99,
          source: "ozon_fbo",
          observedAt: new Date().toISOString(),
        };
        await w.authTransaction(async (tx) => {
          for (const f of [
            base,
            { ...base, id: "previous-month", date: "2023-12-31" },
            { ...base, id: "other-store", storeId: "ozon:other" },
            {
              ...base,
              id: "snapshot",
              source: "operational_snapshot" as const,
            },
          ])
            await historyPut(tx, "forecast_history_facts", f.id, f);
        });
        const service = ForecastHistoryService.forTesting(
          w,
          secrets,
          async () => ({
            facts: [
              {
                id: "replacement",
                externalId: "sku",
                date: "2024-01-03",
                metric: "ordered",
                units: 2,
                source: "ozon_fbo",
              },
            ],
            cursor: null,
          }),
        );
        await manager(() => service.startForecastHistory(start()));
        assert.equal(await service.runNextHistoryPage(), "complete");
        const facts = await w.authTransaction((tx) =>
          historyRows<HistoryFact>(tx, "forecast_history_facts"),
        );
        assert.equal(
          facts.some((f) => f.id === "removed"),
          false,
        );
        for (const id of ["previous-month", "other-store", "snapshot"])
          assert.ok(facts.some((f) => f.id === id));
        assert.equal(facts.length, 4);
        assert.ok(facts.some((f) => f.source === "ozon_fbo" && f.units === 2));
      },
    );
    await t.test(
      "WB retention boundary rejects unavailable report dates without queuing or restricting Ozon",
      async () => {
        await setup();
        const service = ForecastHistoryService.forTesting(
          w,
          secrets,
          async () => ({ facts: [], cursor: null }),
        );
        await assert.rejects(
          manager(() =>
            service.startForecastHistory({
              ...start(),
              provider: "wildberries",
              from: "2024-01-28",
            }),
          ),
          /29 января 2024/,
        );
        assert.equal((await read()).length, 0);
        await manager(() => service.startForecastHistory(start()));
        assert.equal((await read())[0].from, "2024-01-01");
      },
    );
    await t.test(
      "WB old history requires a separately encrypted Finance key and is never read from operational token",
      async () => {
        await setup();
        let calls = 0;
        await w.authTransaction(async (tx) => {
          await put(tx, "marketplace_connections", "wildberries", {
            ...connection,
            provider: "wildberries",
            clientId: null,
            historyStoreId: "wb:store",
            encrypted: await secrets.encrypt(
              { apiKey: "operational" },
              "wildberries",
            ),
          });
        });
        const s = ForecastHistoryService.forTesting(
          w,
          secrets,
          async () => ({ facts: [], cursor: null }),
          async (credentials) => {
            calls++;
            assert.equal(credentials.apiKey, "finance-only-secret");
            return { facts: [], cursor: null };
          },
          async () => "12345678-1234-1234-1234-123456789abc",
        );
        await manager(() =>
          s.startForecastHistory({
            ...start(),
            provider: "wildberries",
            from: "2024-01-29",
          }),
        );
        assert.equal((await read())[0].status, "permission_required");
        assert.equal(await s.runNextHistoryPage(), "skipped");
        const body = { requestId: randomUUID(), apiKey: "finance-only-secret" };
        const response = await manager(() => s.connectForecastFinance(body));
        assert.equal(
          response.providers.find((p) => p.provider === "wildberries")
            ?.financeConfigured,
          true,
        );
        assert.equal(JSON.stringify(response).includes("secret"), false);
        await assert.rejects(
          manager(() =>
            s.connectForecastFinance({ ...body, apiKey: "changed" }),
          ),
        );
        assert.equal(await s.runNextHistoryPage(), "complete");
        assert.equal(calls, 1);
        const coverage = await w.authTransaction((tx) =>
          historyRows<{ scope?: string }>(tx, "forecast_history_coverage"),
        );
        assert.equal(coverage.length, 1);
        assert.equal(coverage[0].scope, "report_window");
        const command = await w.authTransaction((tx) =>
          tx.query(
            "SELECT fingerprint,response FROM commands WHERE request_id=$1",
            [body.requestId],
          ),
        );
        assert.equal(
          JSON.stringify(command.rows).includes("finance-only-secret"),
          false,
        );
      },
    );
    await t.test(
      "Finance seller mismatch and permissions revoked during identity wait never save credentials",
      async () => {
        await setup();
        await w.authTransaction(async (tx) => {
          await put(tx, "marketplace_connections", "wildberries", {
            ...connection,
            provider: "wildberries",
            clientId: null,
            historyStoreId: "wb:store",
            encrypted: await secrets.encrypt(
              { apiKey: "operational" },
              "wildberries",
            ),
          });
        });
        const mismatch = ForecastHistoryService.forTesting(
          w,
          secrets,
          async () => ({ facts: [], cursor: null }),
          async () => ({ facts: [], cursor: null }),
          async (credentials) =>
            credentials.apiKey === "operational" ? "seller-a" : "seller-b",
        );
        await assert.rejects(
          manager(() =>
            mismatch.connectForecastFinance({
              requestId: randomUUID(),
              apiKey: "candidate",
            }),
          ),
        );
        assert.equal(
          (
            await w.authTransaction((tx) => loadMarketplaces(tx))
          ).connections.find((c) => c.provider === "wildberries")
            ?.financeEncrypted,
          undefined,
        );
        const entered = deferred<void>(),
          identity = deferred<string>();
        let calls = 0;
        const waiting = ForecastHistoryService.forTesting(
          w,
          secrets,
          async () => ({ facts: [], cursor: null }),
          async () => ({ facts: [], cursor: null }),
          async () => {
            calls++;
            if (calls === 1) return "seller-a";
            entered.resolve();
            return identity.promise;
          },
        );
        const body = { requestId: randomUUID(), apiKey: "candidate" };
        const pending = manager(() => waiting.connectForecastFinance(body));
        await entered.promise;
        // This independent transaction completing proves the provider wait holds no SQL transaction.
        await w.authTransaction((tx) =>
          tx.query(
            "UPDATE auth_accounts SET role='employee' WHERE id='history-manager'",
          ),
        );
        identity.resolve("seller-a");
        await assert.rejects(pending);
        await w.authTransaction((tx) =>
          tx.query(
            "UPDATE auth_accounts SET role='manager' WHERE id='history-manager'",
          ),
        );
        const c = (
          await w.authTransaction((tx) => loadMarketplaces(tx))
        ).connections.find((c) => c.provider === "wildberries");
        assert.equal(c?.financeEncrypted, undefined);
        assert.equal(
          (
            await w.authTransaction((tx) =>
              tx.query("SELECT request_id FROM commands WHERE request_id=$1", [
                body.requestId,
              ]),
            )
          ).rows.length,
          0,
        );
      },
    );
    assert.deepEqual(await w.snapshot(), before);
  } finally {
    Date.now = realNow;
    await w.onModuleDestroy();
    if (prev === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  }
});
