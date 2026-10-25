import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WarehouseService } from "../src/warehouse.service";
import { MarketplaceService } from "../src/marketplaces/marketplace.service";
import { MarketplaceSecrets } from "../src/marketplaces/secrets";
import { requestAuth } from "../src/auth-context";
import { Connection, loadMarketplaces, put } from "../src/marketplaces/storage";
import { MarketplaceSnapshot } from "../src/marketplaces/providers/types";
import { fetchMarketplaceSnapshot } from "../src/marketplaces/providers";

const slot = () => Math.floor(Date.now() / 1_800_000) * 1_800_000;
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const snapshot = (tag = "new"): MarketplaceSnapshot => ({
  provider: "wildberries",
  from: "2026-09-28",
  to: "2026-10-25",
  asOf: new Date().toISOString(),
  products: [{ externalId: tag, name: "Котики", barcodes: [] }],
  stocks: [],
  demand: [],
  supplies: [],
  inbound: [],
  coverage: { catalog: true, stocks: true, demand: true, inbound: true },
  warnings: [],
});

test("automatic imports use durable claims without human authority or warehouse side effects", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "wms-auto-import-"));
  const previousDir = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = join(dir, "db");
  let warehouse: WarehouseService | undefined;
  try {
    warehouse = new WarehouseService();
    const w = warehouse;
    const baseline = await w.snapshot();
    const secrets = new MarketplaceSecrets({ path: join(dir, "key") });
    await w.authTransaction(async (tx) => {
      await tx.query(
        "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES('auto-test-manager','employee-3','auto-test-manager','test-only','manager',FALSE)",
      );
      await tx.query(
        "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES('auto-test-manager','auto-test-manager','auto-test-manager-token','auto-test-csrf',NOW()+INTERVAL '1 hour')",
      );
    });
    const asManager = <T>(fn: () => T) =>
      requestAuth.run(
        {
          http: true,
          tokenHash: "auto-test-manager-token",
          csrfToken: "auto-test-csrf",
          origin: "http://127.0.0.1:3080",
        },
        fn,
      );
    const encrypted = await secrets.encrypt(
      { apiKey: "private-auto-test-key" },
      "wildberries",
    );
    const baseConnection: Connection = {
      provider: "wildberries",
      encrypted,
      clientId: null,
      enabled: true,
      version: 7,
      syncStatus: "never",
      lastAttemptAt: null,
      lastSuccessAt: null,
      message: null,
      warnings: [],
      runId: null,
    };
    const service = (
      fetcher: typeof fetchMarketplaceSnapshot = async () => snapshot(),
    ) => MarketplaceService.forTesting(w, secrets, fetcher);
    const reset = async (patch: Partial<Connection> = {}) =>
      w.authTransaction(async (tx) => {
        await put(tx, "marketplace_connections", "wildberries", {
          ...baseConnection,
          ...patch,
        });
        await put(
          tx,
          "marketplace_snapshots",
          "wildberries",
          snapshot("previous"),
        );
        await put(tx, "marketplace_mappings", "mapping", {
          provider: "wildberries",
          externalId: "new",
          skuId: "sku-cats",
          unitsPerItem: 1,
        });
        await put(tx, "marketplace_transit", "sku-cats", {
          skuId: "sku-cats",
          units: 20,
        });
      });
    const read = () => w.authTransaction((tx) => loadMarketplaces(tx));
    const protectedState = () =>
      w.authTransaction(async (tx) => {
        const result: Record<string, unknown> = {};
        for (const table of [
          "commands",
          "auth_accounts",
          "auth_sessions",
          "marketplace_mappings",
          "marketplace_task_origins",
        ])
          result[table] = (await tx.query(`SELECT * FROM ${table}`)).rows;
        return result;
      });

    await t.test(
      "imports a complete snapshot without a session, never stores credentials or command responses",
      async () => {
        await reset();
        const before = await protectedState();
        let calls = 0;
        const s = service(async (provider, credentials, period, options) => {
          calls++;
          assert.equal(provider, "wildberries");
          assert.equal(credentials.apiKey, "private-auto-test-key");
          assert.equal(options?.signal?.aborted, false);
          assert.equal(
            (Date.parse(period.to) - Date.parse(period.from)) / 86_400_000 + 1,
            28,
          );
          return snapshot();
        });
        assert.equal(
          await s.syncMarketplaceAutomatically("wildberries", slot()),
          "updated",
        );
        assert.equal(calls, 1);
        const state = await read();
        assert.equal(state.connections[0].syncStatus, "success");
        assert.equal(state.connections[0].encrypted, encrypted);
        assert.equal(state.connections[0].runId, null);
        assert.equal(state.snapshots[0].products[0].externalId, "new");
        assert.deepEqual(state.transit, {});
        assert.ok(!JSON.stringify(state).includes("private-auto-test-key"));
        assert.deepEqual(await protectedState(), before);
        assert.deepEqual(await w.snapshot(), baseline);
        assert.equal(
          await service().syncMarketplaceAutomatically("wildberries", slot()),
          "skipped",
          "new service instance respects persisted lastAttemptAt",
        );
      },
    );
    await t.test(
      "concurrent instances and a manual command cannot overlap an active background claim",
      async () => {
        await reset();
        const started = deferred(),
          release = deferred();
        let calls = 0;
        const fetcher: typeof fetchMarketplaceSnapshot = async () => {
          calls++;
          started.resolve();
          await release.promise;
          return snapshot();
        };
        const pending = service(fetcher).syncMarketplaceAutomatically(
          "wildberries",
          slot(),
        );
        await started.promise;
        assert.equal(
          await service(fetcher).syncMarketplaceAutomatically(
            "wildberries",
            slot(),
          ),
          "skipped",
        );
        await assert.rejects(
          asManager(() =>
            service(fetcher).syncMarketplace({
              requestId: randomUUID(),
              provider: "wildberries",
            }),
          ),
          /уже выполняется/,
        );
        // The manual endpoint still requires real authority, never borrowed from the scheduler.
        await assert.rejects(
          service(fetcher).syncMarketplace({
            requestId: randomUUID(),
            provider: "wildberries",
          }),
          /Войдите/,
        );
        assert.equal(calls, 1);
        assert.equal(
          (await w.snapshot()).revision,
          baseline.revision,
          "network wait does not retain SQL lock",
        );
        release.resolve();
        assert.equal(await pending, "updated");
      },
    );
    await t.test(
      "a manual sync atomically blocks background work during and after its slot",
      async () => {
        await reset();
        const started = deferred(),
          release = deferred();
        let calls = 0;
        const s = service(async () => {
          calls++;
          started.resolve();
          await release.promise;
          return snapshot();
        });
        const pending = asManager(() =>
          s.syncMarketplace({
            requestId: randomUUID(),
            provider: "wildberries",
          }),
        );
        await started.promise;
        assert.equal(
          await service().syncMarketplaceAutomatically("wildberries", slot()),
          "skipped",
        );
        release.resolve();
        assert.equal((await pending).connections[0].syncStatus, "success");
        assert.equal(
          await service().syncMarketplaceAutomatically("wildberries", slot()),
          "skipped",
        );
        assert.equal(calls, 1);
      },
    );
    await t.test(
      "rejects every HTTP context, including manager, before touching stored state",
      async () => {
        await reset();
        const before = await read();
        await assert.rejects(
          requestAuth.run(
            {
              http: true,
              tokenHash: null,
              csrfToken: null,
              origin: null,
              role: "manager",
            },
            () => service().syncMarketplaceAutomatically("wildberries", slot()),
          ),
          /HTTP/,
        );
        assert.deepEqual(await read(), before);
      },
    );
    await t.test(
      "disabled, absent, cancelled and malformed schedules never fetch",
      async () => {
        let calls = 0;
        const s = service(async () => {
          calls++;
          return snapshot();
        });
        await reset({ enabled: false });
        assert.equal(
          await s.syncMarketplaceAutomatically("wildberries", slot()),
          "skipped",
        );
        assert.equal(
          await s.syncMarketplaceAutomatically("ozon", slot()),
          "skipped",
        );
        await reset();
        assert.equal(
          await s.syncMarketplaceAutomatically(
            "wildberries",
            slot(),
            AbortSignal.abort(),
          ),
          "skipped",
        );
        assert.equal(
          await s.syncMarketplaceAutomatically("wildberries", NaN),
          "skipped",
        );
        assert.equal(
          await s.syncMarketplaceAutomatically("wildberries", slot() + 1),
          "skipped",
        );
        assert.equal(
          await s.syncMarketplaceAutomatically(
            "wildberries",
            slot() + 1_800_000,
          ),
          "skipped",
        );
        assert.equal(calls, 0);
      },
    );
    await t.test(
      "fresh manual leases, same-slot attempts and later attempts survive restart without duplicate fetch",
      async () => {
        let calls = 0;
        const s = service(async () => {
          calls++;
          return snapshot();
        });
        await reset({
          syncStatus: "running",
          runId: "manual-run",
          lastAttemptAt: new Date().toISOString(),
        });
        assert.equal(
          await s.syncMarketplaceAutomatically("wildberries", slot()),
          "skipped",
        );
        await reset({
          syncStatus: "failed",
          lastAttemptAt: new Date(slot()).toISOString(),
        });
        assert.equal(
          await s.syncMarketplaceAutomatically("wildberries", slot()),
          "skipped",
        );
        await reset({
          syncStatus: "running",
          lastAttemptAt: new Date(slot()).toISOString(),
        });
        assert.equal(
          await s.syncMarketplaceAutomatically("wildberries", slot()),
          "skipped",
          "even stale same-slot lease waits for next slot",
        );
        assert.equal(calls, 0);
      },
    );
    await t.test(
      "an expired prior-slot claim recovers with a fresh run token",
      async () => {
        await reset({
          syncStatus: "running",
          runId: "expired",
          lastAttemptAt: new Date(slot() - 6 * 60000).toISOString(),
        });
        assert.equal(
          await service().syncMarketplaceAutomatically("wildberries", slot()),
          "updated",
        );
        assert.equal((await read()).connections[0].runId, null);
      },
    );
    await t.test(
      "failure and partial/wrong-provider snapshots retain the last complete snapshot and manual transit",
      async () => {
        for (const mode of ["failed", "partial", "wrong-provider"] as const) {
          await reset();
          const before = await read();
          const s = service(async () => {
            if (mode === "failed")
              throw new Error("private-auto-test-key raw failure");
            const value = snapshot();
            if (mode === "partial") value.coverage.demand = false;
            else value.provider = "ozon";
            return value;
          });
          assert.equal(
            await s.syncMarketplaceAutomatically("wildberries", slot()),
            "failed",
          );
          const after = await read();
          assert.deepEqual(after.snapshots, before.snapshots);
          assert.deepEqual(after.transit, before.transit);
          assert.ok(!JSON.stringify(after).includes("private-auto-test-key"));
          assert.equal(after.connections[0].runId, null);
          assert.equal(
            await s.syncMarketplaceAutomatically("wildberries", slot()),
            "skipped",
          );
        }
      },
    );
    await t.test(
      "unreadable encrypted credentials fail durably without networking or revealing error",
      async () => {
        await reset({ encrypted: "invalid.private-auto-test-key" });
        let calls = 0;
        const s = service(async () => {
          calls++;
          return snapshot();
        });
        assert.equal(
          await s.syncMarketplaceAutomatically("wildberries", slot()),
          "failed",
        );
        assert.equal(
          await s.syncMarketplaceAutomatically("wildberries", slot()),
          "skipped",
        );
        assert.equal(calls, 0);
        const c = (await read()).connections[0];
        assert.equal(c.syncStatus, "failed");
        assert.ok(!c.message!.includes("private-auto-test-key"));
      },
    );
    await t.test(
      "disconnect or replacement during network waits supersedes the old run",
      async () => {
        for (const replace of [false, true]) {
          await reset();
          const before = await read();
          const started = deferred(),
            release = deferred();
          const pending = service(async () => {
            started.resolve();
            await release.promise;
            return snapshot();
          }).syncMarketplaceAutomatically("wildberries", slot());
          await started.promise;
          await w.authTransaction(async (tx) => {
            const c = (await loadMarketplaces(tx)).connections[0];
            c.enabled = replace;
            c.version++;
            c.runId = null;
            c.syncStatus = "never";
            await put(tx, "marketplace_connections", c.provider, c);
          });
          release.resolve();
          assert.equal(await pending, "superseded");
          const after = await read();
          assert.deepEqual(after.snapshots, before.snapshots);
          assert.deepEqual(after.transit, before.transit);
          assert.equal(after.connections[0].version, 8);
          assert.equal(after.connections[0].syncStatus, "never");
        }
      },
    );
    await t.test(
      "shutdown cancels an uncooperative fetch, releases its lease and never publishes a late response",
      async () => {
        await reset();
        const before = await read();
        const started = deferred(),
          release = deferred();
        const controller = new AbortController();
        let observed: AbortSignal | undefined;
        const pending = service(
          async (_provider, _credentials, _period, options) => {
            observed = options?.signal;
            started.resolve();
            await release.promise;
            return snapshot();
          },
        ).syncMarketplaceAutomatically(
          "wildberries",
          slot(),
          controller.signal,
        );
        await started.promise;
        controller.abort();
        assert.equal(await pending, "failed");
        assert.equal(observed?.aborted, true);
        assert.equal((await read()).connections[0].runId, null);
        release.resolve();
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual((await read()).snapshots, before.snapshots);
        assert.deepEqual((await read()).transit, before.transit);
      },
    );
    await t.test(
      "shutdown during snapshot publication rolls back stock evidence and clears only its own claim",
      async () => {
        await reset();
        const before = await read();
        const controller = new AbortController();
        const transact = w.authTransaction.bind(w);
        w.authTransaction = (fn) =>
          transact((tx) =>
            fn({
              query: async <T>(sql: string, params?: any[]) => {
                const result = await tx.query<T>(sql, params);
                if (sql.startsWith("INSERT INTO marketplace_snapshots"))
                  controller.abort();
                return result;
              },
            }),
          );
        try {
          assert.equal(
            await service().syncMarketplaceAutomatically(
              "wildberries",
              slot(),
              controller.signal,
            ),
            "failed",
          );
        } finally {
          w.authTransaction = transact;
        }
        const after = await read();
        assert.deepEqual(after.snapshots, before.snapshots);
        assert.deepEqual(after.transit, before.transit);
        assert.equal(after.connections[0].syncStatus, "failed");
        assert.equal(after.connections[0].runId, null);
      },
    );
    assert.deepEqual(await w.snapshot(), baseline);
  } finally {
    await warehouse?.onModuleDestroy();
    if (previousDir === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  }
});
