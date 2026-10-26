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
import {
  loadMarketplaces,
  put,
  type Connection,
} from "../src/marketplaces/storage";
import { requestAuth } from "../src/auth-context";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
test("verified seller identity preserves WB archives across key rotation without granting access or reassigning history", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "wms-key-rotation-"));
  const previous = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = join(dir, "db");
  const warehouse = new WarehouseService();
  const secrets = new MarketplaceSecrets({ path: join(dir, "key") });
  const sid = "12345678-1234-1234-1234-123456789abc";
  try {
    const before = await warehouse.snapshot();
    await warehouse.authTransaction(async (tx) => {
      await tx.query(
        "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES('rotation-manager','employee-3','rotation-manager','test-only','manager',FALSE)",
      );
      await tx.query(
        "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES('rotation-manager','rotation-manager','rotation-manager','csrf',NOW()+INTERVAL '1 hour')",
      );
    });
    const manager = <T>(fn: () => T) =>
      requestAuth.run(
        {
          http: true,
          tokenHash: "rotation-manager",
          csrfToken: "csrf",
          origin: "http://127.0.0.1:3080",
        },
        fn,
      );
    const old: Connection = {
      provider: "wildberries",
      clientId: null,
      enabled: true,
      version: 1,
      encrypted: await secrets.encrypt(
        { apiKey: "old-private-key" },
        "wildberries",
      ),
      syncStatus: "success",
      lastAttemptAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      runId: null,
      message: null,
      warnings: [],
      historyStoreId: "wb:existing-store",
      historySellerId: sid,
      financeEncrypted: await secrets.encrypt(
        { apiKey: "finance-private-key" },
        "forecast-finance:wb:existing-store",
      ),
      financeVersion: 3,
    };
    const body = () => ({
      requestId: randomUUID(),
      provider: "wildberries" as const,
      apiKey: "new-private-key",
    });
    const seed = () =>
      warehouse.authTransaction(async (tx) => {
        await tx.query("DELETE FROM marketplace_connections");
        await put(tx, "marketplace_connections", old.provider, old);
        await put(tx, "marketplace_mappings", "wildberries/item", {
          provider: "wildberries",
          externalId: "item",
          skuId: "sku-cats",
          unitsPerItem: 1,
        });
        await put(tx, "marketplace_transit", "sku-cats", {
          skuId: "sku-cats",
          units: 20,
        });
      });
    const state = () => warehouse.authTransaction((tx) => loadMarketplaces(tx));
    const service = (
      identity: Parameters<typeof MarketplaceService.forTesting>[3],
    ) =>
      MarketplaceService.forTesting(
        warehouse,
        secrets,
        async () => {
          throw new Error("No snapshot request expected");
        },
        identity,
      );

    await t.test(
      "same SID retains archive, Finance binding, mappings and transit; replay performs no identity requests",
      async () => {
        await seed();
        let calls = 0;
        const s = service(async () => {
          calls++;
          return sid;
        });
        const request = body();
        const response = await manager(() => s.connectMarketplace(request));
        assert.equal(calls, 2);
        assert.equal(JSON.stringify(response).includes("private-key"), false);
        const current = await state();
        const c = current.connections[0];
        assert.equal(c.version, 2);
        assert.equal(c.historyStoreId, old.historyStoreId);
        assert.equal(c.historySellerId, sid);
        assert.equal(c.financeEncrypted, old.financeEncrypted);
        assert.equal(c.financeVersion, old.financeVersion);
        assert.equal(c.syncStatus, "never");
        assert.equal(
          (
            await secrets.decrypt<{ apiKey: string }>(
              c.encrypted,
              "wildberries",
            )
          ).apiKey,
          request.apiKey,
        );
        assert.equal(current.mappings.length, 1);
        assert.equal(current.transit["sku-cats"], 20);
        assert.deepEqual(
          await manager(() => s.connectMarketplace(request)),
          response,
        );
        assert.equal(calls, 2);
      },
    );
    await t.test(
      "different confirmed SID gets a clean account and cannot inherit Finance or mappings",
      async () => {
        await seed();
        const nextSid = "abcdef12-1234-1234-1234-123456789abc";
        const s = service(async (credentials) =>
          credentials.apiKey === "old-private-key" ? sid : nextSid,
        );
        await manager(() => s.connectMarketplace(body()));
        const current = await state(),
          c = current.connections[0];
        assert.notEqual(c.historyStoreId, old.historyStoreId);
        assert.equal(c.historySellerId, nextSid);
        assert.equal(c.financeEncrypted, undefined);
        assert.equal(c.financeVersion, undefined);
        assert.equal(current.mappings.length, 0);
        assert.deepEqual(current.transit, {});
      },
    );
    await t.test(
      "unknown identity leaves the old configuration and command log untouched",
      async () => {
        await seed();
        const request = body();
        const s = service(async () => {
          throw new Error("private-upstream-detail");
        });
        await assert.rejects(
          manager(() => s.connectMarketplace(request)),
          /Текущий ключ и архив сохранены/,
        );
        assert.deepEqual((await state()).connections[0], old);
        const commands = await warehouse.authTransaction((tx) =>
          tx.query("SELECT request_id FROM commands WHERE request_id=$1", [
            request.requestId,
          ]),
        );
        assert.equal(commands.rows.length, 0);
      },
    );
    await t.test(
      "revoked authority during identity wait prevents publication and holds no SQL lock",
      async () => {
        await seed();
        const entered = deferred<void>(),
          identity = deferred<string>();
        let calls = 0;
        const s = service(async () => {
          calls++;
          if (calls === 1) return sid;
          entered.resolve();
          return identity.promise;
        });
        const pending = manager(() => s.connectMarketplace(body()));
        await entered.promise;
        await warehouse.authTransaction((tx) =>
          tx.query(
            "UPDATE auth_accounts SET role='employee' WHERE id='rotation-manager'",
          ),
        );
        identity.resolve(sid);
        await assert.rejects(pending, /руководителя/);
        assert.deepEqual((await state()).connections[0], old);
        await warehouse.authTransaction((tx) =>
          tx.query(
            "UPDATE auth_accounts SET role='manager' WHERE id='rotation-manager'",
          ),
        );
      },
    );
    await t.test(
      "a concurrent connection revision supersedes the checked candidate",
      async () => {
        await seed();
        const entered = deferred<void>(),
          identity = deferred<string>();
        let calls = 0;
        const s = service(async () => {
          if (++calls === 1) return sid;
          entered.resolve();
          return identity.promise;
        });
        const pending = manager(() => s.connectMarketplace(body()));
        await entered.promise;
        await warehouse.authTransaction((tx) =>
          put(tx, "marketplace_connections", old.provider, {
            ...old,
            version: 2,
          }),
        );
        identity.resolve(sid);
        await assert.rejects(pending, /Подключение изменилось/);
        assert.deepEqual((await state()).connections[0], {
          ...old,
          version: 2,
        });
      },
    );
    await t.test(
      "unverified legacy identity is never assumed to match a replacement key",
      async () => {
        await seed();
        await warehouse.authTransaction((tx) =>
          put(tx, "marketplace_connections", old.provider, {
            ...old,
            historySellerId: undefined,
          }),
        );
        const s = service(async () => {
          throw new Error("No identity call expected");
        });
        await manager(() => s.connectMarketplace(body()));
        const c = (await state()).connections[0];
        assert.notEqual(c.historyStoreId, old.historyStoreId);
        assert.equal(c.financeEncrypted, undefined);
      },
    );
    assert.deepEqual(await warehouse.snapshot(), before);
  } finally {
    await warehouse.onModuleDestroy();
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
