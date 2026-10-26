import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app";
import { WarehouseService } from "../src/warehouse.service";
import { hashToken } from "../src/auth-storage";
import { cookieName } from "../src/auth.controller";

test("forecast routes are manager-only, CSRF protected, strictly validated and inert on read", async () => {
  const oldDir = process.env.WMS_DATA_DIR,
    oldNode = process.env.NODE_ENV;
  process.env.WMS_DATA_DIR = "memory://";
  process.env.NODE_ENV = "test";
  const app = await createApp();
  try {
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl(),
      w = app.get(WarehouseService);
    const baseline = await w.snapshot();
    const tokens = { manager: "a".repeat(43), employee: "b".repeat(43) };
    await w.authTransaction(async (tx) => {
      for (const role of ["manager", "employee"] as const) {
        await tx.query(
          "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES($1,$2,$1,'fixture',$1,FALSE)",
          [role, role === "manager" ? "employee-3" : "employee-1"],
        );
        await tx.query(
          "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES($1,$1,$2,$3,NOW()+INTERVAL '1 hour')",
          [role, hashToken(tokens[role]), `csrf-${role}`],
        );
      }
    });
    async function call(
      path: string,
      role?: keyof typeof tokens,
      body?: unknown,
      csrf = true,
    ) {
      return fetch(`${base}/api/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:3080",
          ...(role
            ? {
                Cookie: `${cookieName()}=${tokens[role]}`,
                ...(csrf ? { "X-WMS-CSRF": `csrf-${role}` } : {}),
              }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    for (const path of [
      "forecast",
      "forecast/history",
      "forecast/history/series?skuId=sku-cats",
    ]) {
      assert.equal((await call(path)).status, 401);
      assert.equal((await call(path, "employee")).status, 403);
      const response = await call(path, "manager");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    const policy = {
      requestId: randomUUID(),
      skuId: "sku-cats",
      minimumBoxes: 1,
      seasonalityEnabled: true,
    };
    assert.equal(
      (await call("forecast/policy", "manager", policy, false)).status,
      403,
    );
    assert.equal(
      (await call("forecast/policy", "employee", policy)).status,
      403,
    );
    assert.equal(
      (await call("forecast/policy", "manager", { ...policy, extra: true }))
        .status,
      400,
    );
    assert.equal(
      (
        await call("forecast/policy", "manager", {
          ...policy,
          minimumBoxes: -1,
        })
      ).status,
      400,
    );
    const saved = await call("forecast/policy", "manager", policy);
    assert.equal(saved.status, 200);
    const replay = await call("forecast/policy", "manager", policy);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), await saved.json());
    assert.equal(
      (
        await call("forecast/history/backfill", "employee", {
          requestId: randomUUID(),
          provider: "ozon",
          from: "2024-01-29",
          to: "2024-02-01",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("forecast/history/finance", "manager", {
          requestId: randomUUID(),
          apiKey: "",
          extra: true,
        })
      ).status,
      400,
    );
    await w.authTransaction(async (tx) => {
      assert.equal(
        (await tx.query("SELECT id FROM forecast_history_jobs")).rows.length,
        0,
        "GET never starts historical jobs",
      );
      assert.equal(
        (await tx.query("SELECT id FROM forecast_results")).rows.length,
        0,
        "DI/HTTP never start scheduler",
      );
    });
    assert.deepEqual(await w.snapshot(), baseline);
  } finally {
    await app.close();
    if (oldDir === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = oldDir;
    if (oldNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNode;
  }
});
