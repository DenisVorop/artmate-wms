import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WarehouseService } from "../src/warehouse.service";
import { MarketplaceService } from "../src/marketplaces/marketplace.service";
import { requestAuth } from "../src/auth-context";
import { trackedFinishedUnits } from "../src/marketplaces/planning-stock";
import {
  initializeMarketplaceStorage,
  loadMarketplaces,
} from "../src/marketplaces/storage";
test("planning confirmations are additive management data with transactional audit, CSRF and replay protections", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "wms-counts-")),
    prev = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = join(dir, "db");
  const w = new WarehouseService();
  try {
    const baseline = await w.snapshot(),
      service = new MarketplaceService(w),
      tracked = trackedFinishedUnits(baseline, "sku-cats");
    await w.authTransaction(async (tx) => {
      await tx.query(
        "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES('counts-manager','employee-3','counts-manager','test-only','manager',FALSE),('counts-worker','employee-1','counts-worker','test-only','employee',FALSE)",
      );
      await tx.query(
        "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES('counts-manager','counts-manager','counts-manager','csrf',NOW()+INTERVAL '1 hour'),('counts-worker','counts-worker','counts-worker','csrf',NOW()+INTERVAL '1 hour')",
      );
    });
    const manager = <T>(fn: () => T, csrf = "csrf", token = "counts-manager") =>
      requestAuth.run(
        {
          http: true,
          tokenHash: token,
          csrfToken: csrf,
          origin: "http://127.0.0.1:3080",
        },
        fn,
      );
    const body = () => ({
      requestId: randomUUID(),
      entries: [
        {
          skuId: "sku-cats",
          enabled: true,
          units: tracked + 60,
          accuracy: "exact" as const,
          note: "Реальный пересчёт",
        },
      ],
    });
    const audit = () =>
      w.authTransaction((tx) =>
        tx.query<{ payload: any }>(
          "SELECT payload FROM planning_stock_confirmation_events ORDER BY id",
        ),
      );
    const physical = () =>
      w.authTransaction(async (tx) => {
        const result: Record<string, unknown> = {};
        for (const table of [
          "stock_ledger",
          "marketplace_connections",
          "marketplace_snapshots",
          "forecast_results",
          "forecast_policies",
        ]) {
          result[table] = (
            await tx.query(`SELECT * FROM ${table} ORDER BY 1`)
          ).rows;
        }
        return result;
      });
    const physicalBefore = await physical();
    await t.test("anonymous/worker/bad CSRF cannot write", async () => {
      await assert.rejects(service.confirmPlanningStock(body()));
      await assert.rejects(
        manager(() => service.confirmPlanningStock(body()), "wrong"),
      );
      await assert.rejects(
        manager(
          () => service.confirmPlanningStock(body()),
          "csrf",
          "counts-worker",
        ),
      );
      assert.equal((await audit()).rows.length, 0);
    });
    await t.test(
      "same replay is cached once, conflicting replay or revoked manager never bypasses current authorization",
      async () => {
        const b = body(),
          first = await manager(() => service.confirmPlanningStock(b));
        assert.equal(first.planningStock[0].units, tracked + 60);
        assert.equal(first.planningStock[0].trackedUnitsAtCount, tracked);
        assert.equal(first.planningStock[0].revision, 1);
        assert.equal("actorAccountId" in first.planningStock[0], false);
        assert.deepEqual(
          await manager(() => service.confirmPlanningStock(b)),
          first,
        );
        assert.equal((await audit()).rows.length, 1);
        await assert.rejects(
          manager(() =>
            service.confirmPlanningStock({
              ...b,
              entries: [{ ...b.entries[0], units: tracked + 80 }],
            }),
          ),
        );
        await w.authTransaction((tx) =>
          tx.query(
            "UPDATE auth_accounts SET role='employee' WHERE id='counts-manager'",
          ),
        );
        await assert.rejects(manager(() => service.confirmPlanningStock(b)));
        await w.authTransaction((tx) =>
          tx.query(
            "UPDATE auth_accounts SET role='manager' WHERE id='counts-manager'",
          ),
        );
        const event = (await audit()).rows[0].payload;
        assert.equal(event.actorAccountId, "counts-manager");
        assert.equal(event.changes[0].previous, null);
      },
    );
    await t.test(
      "a new count advances its SKU revision and keeps immutable prior evidence",
      async () => {
        const b = body();
        b.entries[0].units = tracked + 100;
        const response = await manager(() => service.confirmPlanningStock(b));
        assert.equal(response.planningStock[0].revision, 2);
        assert.equal((await audit()).rows.length, 2);
        await assert.rejects(
          w.authTransaction((tx) =>
            tx.query(
              "UPDATE planning_stock_confirmation_events SET payload='{}'::jsonb",
            ),
          ),
        );
        await assert.rejects(
          w.authTransaction((tx) =>
            tx.query("DELETE FROM planning_stock_confirmation_events"),
          ),
        );
        assert.equal((await audit()).rows.length, 2);
      },
    );
    await t.test(
      "duplicate SKU, nested unknown fields and a bad batch row roll back the entire count",
      async () => {
        const current = (await manager(() => service.getMarketplaces()))
            .planningStock,
          events = (await audit()).rows.length;
        const b = body();
        await assert.rejects(
          manager(() =>
            service.confirmPlanningStock({
              ...b,
              entries: [b.entries[0], b.entries[0]],
            }),
          ),
        );
        await assert.rejects(
          manager(() =>
            service.confirmPlanningStock({
              ...body(),
              entries: [{ ...b.entries[0], unexpected: true }],
            } as any),
          ),
        );
        await assert.rejects(
          manager(() =>
            service.confirmPlanningStock({
              ...body(),
              entries: [b.entries[0], { ...b.entries[0], skuId: "unknown" }],
            }),
          ),
        );
        await assert.rejects(
          manager(() =>
            service.confirmPlanningStock({
              ...body(),
              entries: [{ ...b.entries[0], units: -1 }],
            }),
          ),
        );
        assert.deepEqual(
          (await manager(() => service.getMarketplaces())).planningStock,
          current,
        );
        assert.equal((await audit()).rows.length, events);
      },
    );
    await t.test(
      "storage reinitialization preserves the count, old inventory, credentials and forecast cache",
      async () => {
        const before = (await manager(() => service.getMarketplaces()))
          .planningStock;
        await w.authTransaction((tx) => initializeMarketplaceStorage(tx));
        assert.deepEqual(
          (await manager(() => service.getMarketplaces())).planningStock,
          before,
        );
        assert.deepEqual(await w.snapshot(), baseline);
        assert.deepEqual(await physical(), physicalBefore);
        assert.equal(
          (await w.authTransaction((tx) => loadMarketplaces(tx))).planningStock
            ?.length,
          1,
        );
        const version = await w.authTransaction((tx) =>
          tx.query<{ value: string }>(
            "SELECT value FROM metadata WHERE key='schema_version'",
          ),
        );
        assert.equal(version.rows[0].value, "16");
      },
    );
  } finally {
    await w.onModuleDestroy();
    if (prev === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  }
});
