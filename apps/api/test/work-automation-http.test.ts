import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app";
import { WarehouseService } from "../src/warehouse.service";
import { cookieName } from "../src/auth.controller";
import { hashToken, randomToken } from "../src/auth-storage";
const origin = "http://127.0.0.1:3080";
test("work automation HTTP routes require fresh manager auth, strict CSRF/origin, DTOs and namespaced replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-work-auto-http-"));
  const original = {
    WMS_DATA_DIR: process.env.WMS_DATA_DIR,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    NODE_ENV: process.env.NODE_ENV,
  };
  process.env.WMS_DATA_DIR = join(dir, "db");
  process.env.WEB_ORIGIN = origin;
  process.env.NODE_ENV = "test";
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    app = await createApp();
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl(),
      w = app.get(WarehouseService),
      baseline = await w.snapshot();
    const identities = {
      manager: { token: randomToken(), csrf: randomToken() },
      employee: { token: randomToken(), csrf: randomToken() },
    };
    await w.authTransaction(async (tx) => {
      for (const role of ["manager", "employee"] as const) {
        await tx.query(
          "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES($1,$2,$1,'test-only',$1,FALSE)",
          [role, role === "manager" ? "employee-3" : "employee-1"],
        );
        await tx.query(
          "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES($1,$1,$2,$3,NOW()+INTERVAL '1 hour')",
          [role, hashToken(identities[role].token), identities[role].csrf],
        );
      }
    });
    const call = async (
      method: string,
      path: string,
      body?: unknown,
      role?: keyof typeof identities,
      headers: Record<string, string> = {},
    ) => {
      const identity = role ? identities[role] : undefined;
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          ...(identity
            ? {
                Cookie: `${cookieName()}=${identity.token}`,
                "X-WMS-CSRF": identity.csrf,
              }
            : {}),
          ...headers,
        },
        ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: await response.json(),
        headers: response.headers,
      };
    };
    const body = { requestId: randomUUID(), enabled: false };
    for (const [method, path, value] of [
      ["GET", "/work-automation", undefined],
      ["POST", "/work-automation/settings", body],
    ] as const) {
      assert.equal((await call(method, path, value)).status, 401);
      assert.equal((await call(method, path, value, "employee")).status, 403);
    }
    const current = await call("GET", "/work-automation", undefined, "manager");
    assert.equal(current.status, 200);
    assert.equal(current.body.enabled, true);
    assert.equal(current.headers.get("cache-control"), "no-store");
    assert.equal(typeof current.body.queuedAssemblyTasks, "number");
    for (const headers of [
      { "X-WMS-CSRF": "" },
      { Origin: "" },
      { Origin: "https://evil.invalid" },
      { "Content-Type": "text/plain" },
    ] as Record<string, string>[])
      assert.equal(
        (
          await call(
            "POST",
            "/work-automation/settings",
            body,
            "manager",
            headers,
          )
        ).status,
        403,
      );
    for (const patch of [
      { requestId: null },
      { requestId: "" },
      { enabled: "false" },
      { enabled: null },
      { unexpected: true },
    ])
      assert.equal(
        (
          await call(
            "POST",
            "/work-automation/settings",
            { ...body, ...patch },
            "manager",
          )
        ).status,
        400,
      );
    const paused = await call(
      "POST",
      "/work-automation/settings",
      body,
      "manager",
    );
    assert.equal(paused.status, 200);
    assert.equal(paused.body.enabled, false);
    assert.deepEqual(
      (await call("POST", "/work-automation/settings", body, "manager")).body,
      paused.body,
    );
    assert.equal(
      (
        await call(
          "POST",
          "/work-automation/settings",
          { ...body, enabled: true },
          "manager",
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await call(
          "POST",
          "/tasks",
          { requestId: body.requestId, skuId: "sku-cats", boxesTarget: 1 },
          "manager",
        )
      ).status,
      409,
    );
    const command = randomUUID();
    await w.authTransaction((tx) =>
      tx.query(
        "INSERT INTO commands(request_id,fingerprint,response) VALUES($1,'other','{}')",
        [command],
      ),
    );
    assert.equal(
      (
        await call(
          "POST",
          "/work-automation/settings",
          { requestId: command, enabled: true },
          "manager",
        )
      ).status,
      409,
    );
    // Constructor/export/GET/settings never start the background scheduler.
    assert.deepEqual(await w.snapshot(), baseline);
    await w.authTransaction((tx) =>
      tx.query("UPDATE auth_accounts SET blocked=TRUE WHERE id='manager'"),
    );
    assert.equal(
      (await call("POST", "/work-automation/settings", body, "manager")).status,
      401,
    );
    assert.equal(
      (await call("GET", "/work-automation", undefined, "manager")).status,
      401,
    );
  } finally {
    await app?.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
