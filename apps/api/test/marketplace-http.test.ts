import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app";
import { WarehouseService } from "../src/warehouse.service";
import { cookieName } from "../src/auth.controller";
import { hashToken, randomToken } from "../src/auth-storage";
const origin = "http://127.0.0.1:3080";
const req = () => ({ requestId: randomUUID() });
test("marketplace HTTP routes enforce fresh manager auth, CSRF/origin, strict DTOs and safe encrypted connection responses", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-marketplace-http-"));
  const original = {
    WMS_DATA_DIR: process.env.WMS_DATA_DIR,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    NODE_ENV: process.env.NODE_ENV,
    WMS_MARKETPLACE_KEY: process.env.WMS_MARKETPLACE_KEY,
  };
  process.env.WMS_DATA_DIR = join(dir, "db");
  process.env.WEB_ORIGIN = origin;
  process.env.NODE_ENV = "test";
  process.env.WMS_MARKETPLACE_KEY = randomBytes(32).toString("base64");
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
      body: unknown,
      role?: keyof typeof identities,
      headers: Record<string, string> = {},
    ) => {
      const identity = role ? identities[role] : undefined;
      const response = await fetch(`${base}/api/marketplaces${path}`, {
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
    const routes: [string, string, unknown][] = [
      ["GET", "", undefined],
      [
        "POST",
        "/connections",
        { ...req(), provider: "wildberries", apiKey: "synthetic-key" },
      ],
      [
        "POST",
        "/connections/toggle",
        { ...req(), provider: "wildberries", enabled: true },
      ],
      ["POST", "/sync", { ...req(), provider: "wildberries" }],
      [
        "POST",
        "/mappings",
        {
          ...req(),
          provider: "wildberries",
          externalId: "card",
          skuId: "sku-cats",
          unitsPerItem: 1,
        },
      ],
      [
        "POST",
        "/settings",
        {
          ...req(),
          horizonDays: 14,
          safetyDays: 3,
          leadDays: 7,
          historyDays: 28,
        },
      ],
      [
        "POST",
        "/tasks",
        { ...req(), skuId: "sku-cats", proposalHash: "0".repeat(64) },
      ],
    ];
    for (const [method, path, body] of routes) {
      assert.equal(
        (await call(method, path, body)).status,
        401,
        `${method} ${path} anonymous`,
      );
      assert.equal(
        (await call(method, path, body, "employee")).status,
        403,
        `${method} ${path} employee`,
      );
    }
    assert.equal(
      (
        await call(
          "POST",
          "/transit",
          { ...req(), skuId: "sku-cats", inTransitUnits: 0 },
          "manager",
        )
      ).status,
      404,
      "manual transit entry was removed",
    );
    const empty = await call("GET", "", undefined, "manager");
    assert.equal(empty.status, 200);
    assert.deepEqual(
      empty.body.connections.map((c: { configured: boolean }) => c.configured),
      [false, false],
    );
    assert.equal(empty.headers.get("cache-control"), "no-store");
    const connect = {
      ...req(),
      provider: "wildberries",
      apiKey: "private-http-synthetic-key-123",
    };
    for (const headers of [
      { "X-WMS-CSRF": "" },
      { Origin: "" },
      { Origin: "https://evil.invalid" },
      { "Content-Type": "text/plain" },
    ] as Record<string, string>[])
      assert.equal(
        (await call("POST", "/connections", connect, "manager", headers))
          .status,
        403,
      );
    for (const patch of [
      { apiKey: null },
      { provider: null },
      { requestId: null },
      { unexpected: true },
      { apiKey: "" },
      { provider: "amazon" },
    ])
      assert.equal(
        (
          await call(
            "POST",
            "/connections",
            { ...connect, ...patch },
            "manager",
          )
        ).status,
        400,
      );
    const connected = await call("POST", "/connections", connect, "manager");
    assert.equal(connected.status, 200, JSON.stringify(connected.body));
    assert.equal(connected.body.connections[0].configured, true);
    assert.ok(!JSON.stringify(connected.body).includes(connect.apiKey));
    assert.ok(!JSON.stringify(connected.body).includes("encrypted"));
    assert.deepEqual(
      (await call("POST", "/connections", connect, "manager")).body,
      connected.body,
    );
    const safe = await call("GET", "", undefined, "manager");
    assert.equal(safe.status, 200);
    assert.ok(!JSON.stringify(safe.body).includes(connect.apiKey));
    await w.authTransaction(async (tx) => {
      const connection = await tx.query<{ payload: { encrypted: string } }>(
        "SELECT payload FROM marketplace_connections",
      );
      assert.match(connection.rows[0].payload.encrypted, /^v1\./);
      assert.ok(!JSON.stringify(connection.rows).includes(connect.apiKey));
      const commands = await tx.query(
        "SELECT fingerprint,response FROM commands WHERE request_id=$1",
        [connect.requestId],
      );
      assert.ok(!JSON.stringify(commands.rows).includes(connect.apiKey));
      await tx.query(
        "UPDATE auth_accounts SET blocked=TRUE WHERE id='manager'",
      );
    });
    assert.equal(
      (await call("POST", "/connections", connect, "manager")).status,
      401,
    );
    assert.equal((await call("GET", "", undefined, "manager")).status, 401);
    assert.deepEqual(await w.snapshot(), baseline);
  } finally {
    await app?.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
