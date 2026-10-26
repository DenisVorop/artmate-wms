import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WarehouseService } from "../src/warehouse.service";
import { requestAuth } from "../src/auth-context";
import { ForecastService } from "../src/forecasting/forecast-service";
import { computeForecast } from "../src/forecasting/forecast-projection";
import {
  forecastCache,
  initializeForecastStorage,
  readForecastPlanContext,
} from "../src/forecasting/forecast-storage";
import { loadMarketplaces } from "../src/marketplaces/storage";
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("forecast cache, authority, idempotency, revision guards and graceful cancellation", async (t) => {
  const old = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  const w = new WarehouseService();
  try {
    const workspace = await w.snapshot(),
      sku = workspace.skus[0];
    await w.authTransaction(async (tx) => {
      await initializeForecastStorage(tx);
      await tx.query(
        "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES('forecast-manager','employee-3','forecast-manager','test-only','manager',FALSE),('forecast-worker','employee-1','forecast-worker','test-only','employee',FALSE)",
      );
      await tx.query(
        "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES('forecast-manager','forecast-manager','forecast-manager-token','forecast-csrf',NOW()+INTERVAL '1 hour'),('forecast-worker','forecast-worker','forecast-worker-token','worker-csrf',NOW()+INTERVAL '1 hour')",
      );
    });
    const asManager = <T>(f: () => T, csrf = "forecast-csrf") =>
      requestAuth.run(
        {
          http: true,
          tokenHash: "forecast-manager-token",
          csrfToken: csrf,
          origin: "http://127.0.0.1:3080",
        },
        f,
      );
    const asEmployee = <T>(f: () => T) =>
      requestAuth.run(
        {
          http: true,
          tokenHash: "forecast-worker-token",
          csrfToken: "worker-csrf",
          origin: "http://127.0.0.1:3080",
        },
        f,
      );
    const now = () => new Date("2026-10-26T10:00:00Z");
    let calls = 0;
    const service = ForecastService.forTesting(
      w,
      async (input) => {
        calls++;
        return computeForecast(input);
      },
      now,
    );
    const context = () =>
      w.authTransaction(async (tx) =>
        readForecastPlanContext(tx, await loadMarketplaces(tx), now()),
      );
    const invalidate = () =>
      w.authTransaction(async (tx) => {
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["forecast_history_revision", randomUUID()],
        );
      });
    await t.test(
      "reads require manager and never compute; worker/background has no fake HTTP authority",
      async () => {
        await assert.rejects(service.getForecastOverview(), /Войдите/);
        await assert.rejects(
          asEmployee(() => service.getForecastOverview()),
          /руководителя/,
        );
        const initial = await asManager(() => service.getForecastOverview());
        assert.equal(initial.ready, false);
        assert.equal(calls, 0);
        await assert.rejects(
          asManager(() => service.runForecastComputation()),
          /HTTP/,
        );
      },
    );
    await t.test(
      "one cached computation is reused; a new history revision invalidates it",
      async () => {
        const warehouseBefore = await w.snapshot();
        assert.equal(await service.runForecastComputation(), "updated");
        assert.equal(calls, 1);
        assert.equal(await service.runForecastComputation(), "skipped");
        assert.equal(calls, 1);
        assert.equal(
          (await asManager(() => service.getForecastOverview())).ready,
          true,
        );
        const first = await context();
        assert.ok(first.goals[sku.id]);
        await invalidate();
        const stale = await context();
        assert.notEqual(first.key, stale.key);
        assert.deepEqual(stale.goals, {});
        assert.equal(
          (await asManager(() => service.getForecastOverview())).ready,
          false,
        );
        assert.equal(await service.runForecastComputation(), "updated");
        assert.deepEqual(await w.snapshot(), warehouseBefore);
      },
    );
    await t.test(
      "policy writes require CSRF; replay is actor-bound and does not duplicate mutations",
      async () => {
        const body = {
          requestId: randomUUID(),
          skuId: sku.id,
          minimumBoxes: 3,
          seasonalityEnabled: false,
        };
        await assert.rejects(
          asEmployee(() => service.updateForecastPolicy(body)),
          /руководителя/,
        );
        await assert.rejects(
          asManager(() => service.updateForecastPolicy(body), "bad"),
          /Проверка/,
        );
        const result = await asManager(() =>
          service.updateForecastPolicy(body),
        );
        assert.equal(
          result.rows.find((r) => r.skuId === sku.id)!.minimumBoxes,
          3,
        );
        assert.equal(result.ready, false);
        assert.equal((await context()).minimumBoxes[sku.id], 3);
        assert.deepEqual(
          await asManager(() => service.updateForecastPolicy(body)),
          result,
        );
        await assert.rejects(
          asManager(() =>
            service.updateForecastPolicy({ ...body, minimumBoxes: 4 }),
          ),
          /requestId/,
        );
        await assert.rejects(
          asManager(() =>
            service.updateForecastPolicy({
              ...body,
              requestId: randomUUID(),
              minimumBoxes: -1,
            }),
          ),
          /настройки/,
        );
        assert.equal(
          (
            await w.authTransaction((tx) =>
              tx.query("SELECT request_id FROM commands"),
            )
          ).rows.length,
          1,
        );
      },
    );
    await t.test(
      "durable lease deduplicates service instances and a changed input discards a slow result",
      async () => {
        const started = deferred<void>(),
          release = deferred<void>();
        const slow = ForecastService.forTesting(
          w,
          async (input) => {
            started.resolve();
            await release.promise;
            return computeForecast(input);
          },
          now,
        );
        const running = slow.runForecastComputation();
        await started.promise;
        assert.equal(await service.runForecastComputation(), "skipped");
        await invalidate();
        release.resolve();
        assert.equal(await running, "superseded");
        assert.equal((await context()).goals[sku.id], undefined);
        assert.equal(await service.runForecastComputation(), "updated");
      },
    );
    await t.test(
      "shutdown discards a noncooperative late worker and releases only its own lease",
      async () => {
        await invalidate();
        const prior = await w.authTransaction((tx) => forecastCache(tx));
        const started = deferred<void>(),
          release = deferred<void>(),
          controller = new AbortController();
        const slow = ForecastService.forTesting(
          w,
          async (input) => {
            started.resolve();
            await release.promise;
            return computeForecast(input);
          },
          now,
        );
        const running = slow.runForecastComputation(controller.signal);
        await started.promise;
        controller.abort();
        release.resolve();
        assert.equal(await running, "skipped");
        assert.deepEqual(
          await w.authTransaction((tx) => forecastCache(tx)),
          prior,
        );
        assert.equal(await service.runForecastComputation(), "updated");
      },
    );
    await t.test(
      "failed worker retains the last cache, reports a safe retry message and releases the lease",
      async () => {
        await invalidate();
        const prior = await w.authTransaction((tx) => forecastCache(tx));
        const failing = ForecastService.forTesting(
          w,
          async () => {
            throw new Error("private upstream payload must not appear");
          },
          now,
        );
        assert.equal(await failing.runForecastComputation(), "failed");
        assert.deepEqual(
          await w.authTransaction((tx) => forecastCache(tx)),
          prior,
        );
        const overview = await asManager(() => failing.getForecastOverview());
        assert.equal(overview.ready, false);
        assert.equal(overview.computing, false);
        assert.match(overview.message, /повторим автоматически/);
        assert.equal(
          JSON.stringify(overview).includes("private upstream"),
          false,
        );
        assert.equal(await service.runForecastComputation(), "updated");
      },
    );
    await t.test(
      "a revoked manager cannot replay a previously authorized command",
      async () => {
        const body = {
          requestId: randomUUID(),
          skuId: sku.id,
          minimumBoxes: 4,
          seasonalityEnabled: false,
        };
        await asManager(() => service.updateForecastPolicy(body));
        await w.authTransaction((tx) =>
          tx.query(
            "UPDATE auth_accounts SET role='employee' WHERE id='forecast-manager'",
          ),
        );
        await assert.rejects(
          asManager(() => service.updateForecastPolicy(body)),
          /руководителя/,
        );
      },
    );
  } finally {
    await w.onModuleDestroy();
    if (old === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = old;
  }
});
