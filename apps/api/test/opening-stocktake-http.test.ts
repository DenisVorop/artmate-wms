import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";
import { WarehouseService } from "../src/warehouse.service";
import { cookieName } from "../src/auth.controller";
import { hashToken, randomToken } from "../src/auth-storage";
const req = () => ({ requestId: randomUUID() });
const origin = "http://127.0.0.1:3080";
test("opening stocktake uses existing HTTP lifecycle with strict nested observations, auth, CSRF and legacy recount compatibility", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-opening-http-"));
  const previous = {
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
      w = app.get(WarehouseService);
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
    await w.updateWarehousePlan({ ...req(), width: 100, depth: 100 });
    const createLocation = async (code: string, x: number) => {
      const state = await w.createLocation({
        ...req(),
        code,
        name: code,
        kind: "floor",
        x,
        y: 40,
        width: 2,
        depth: 2,
        levels: 1,
        maxHeightMm: 2500,
        maxBoxes: 36,
        availableWidthMm: 1200,
        availableDepthMm: 800,
        maxWeightKg: null,
        accessSides: 4,
      });
      return state.locations.find((location) => location.code === code)!;
    };
    const address = await createLocation("OPEN-HTTP", 40),
      recountAddress = await createLocation("RECOUNT-HTTP", 43);
    const call = async (
      method: string,
      path: string,
      body?: unknown,
      role: keyof typeof identities | null = "manager",
      headers: Record<string, string> = {},
    ) => {
      const identity = role ? identities[role] : undefined;
      const response = await fetch(`${base}/api/stocktakes${path}`, {
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
      return { status: response.status, body: await response.json() };
    };
    const create = { ...req(), mode: "opening", locationIds: [address.id] };
    assert.equal((await call("POST", "", create, null)).status, 401);
    assert.equal((await call("POST", "", create, "employee")).status, 403);
    assert.equal(
      (await call("POST", "", { ...create, mode: "invented" })).status,
      400,
    );
    const created = await call("POST", "", create);
    assert.equal(created.status, 200);
    let doc = created.body;
    assert.equal(doc.mode, "opening");
    doc = (
      await call("POST", `/${doc.id}/claim`, {
        ...req(),
        expectedRevision: doc.revision,
      })
    ).body;
    const before = await w.snapshot();
    const countBody = {
      ...req(),
      expectedRevision: doc.revision,
      locationCode: address.code,
      rawPallets: [],
      boxCodes: [],
    };
    assert.equal(
      (await call("POST", `/${doc.id}/rows/${address.id}/count`, countBody))
        .status,
      400,
    );
    const openingPallet = {
      kind: "raw",
      skuId: "sku-cats",
      heightMm: 730,
      batches: [{ receivedAt: "2026-10-01T09:00:00Z", quantity: 1000 }],
    };
    for (const patch of [
      { ...openingPallet, surprise: true },
      {
        ...openingPallet,
        batches: [{ ...openingPallet.batches[0], surprise: true }],
      },
      {
        ...openingPallet,
        batches: [{ receivedAt: "2026-02-31", quantity: 2 }],
      },
      {
        ...openingPallet,
        batches: [{ receivedAt: "2099-01-01", quantity: 2 }],
      },
    ])
      assert.equal(
        (
          await call("POST", `/${doc.id}/rows/${address.id}/count`, {
            ...countBody,
            ...req(),
            openingPallet: patch,
          })
        ).status,
        400,
      );
    const counted = await call("POST", `/${doc.id}/rows/${address.id}/count`, {
      ...countBody,
      openingPallet,
    });
    assert.equal(counted.status, 200, JSON.stringify(counted.body));
    doc = counted.body;
    assert.deepEqual(await w.snapshot(), before);
    doc = (
      await call("POST", `/${doc.id}/submit`, {
        ...req(),
        expectedRevision: doc.revision,
      })
    ).body;
    const approval = {
      ...req(),
      expectedRevision: doc.revision,
      reason: "Фактический сырьевой остаток подтверждён",
    };
    assert.equal(
      (
        await call("POST", `/${doc.id}/approve`, approval, "manager", {
          "X-WMS-CSRF": "wrong",
        })
      ).status,
      403,
    );
    const approved = await call("POST", `/${doc.id}/approve`, approval);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.status, "approved");
    assert.ok(approved.body.rows[0].openingResult.palletId);
    assert.deepEqual(
      (await call("POST", `/${doc.id}/approve`, approval)).body,
      approved.body,
    );
    assert.equal(
      (await call("GET", `/${doc.id}`, undefined, "employee")).status,
      403,
    );
    // The optional opening field must not change the old recount HTTP payload.
    let recount = (
      await call("POST", "", { ...req(), locationIds: [recountAddress.id] })
    ).body;
    assert.equal(recount.mode, "recount");
    recount = (
      await call("POST", `/${recount.id}/claim`, {
        ...req(),
        expectedRevision: recount.revision,
      })
    ).body;
    const oldCount = await call(
      "POST",
      `/${recount.id}/rows/${recountAddress.id}/count`,
      {
        ...req(),
        expectedRevision: recount.revision,
        locationCode: recountAddress.code,
        rawPallets: [],
        boxCodes: [],
      },
    );
    assert.equal(oldCount.status, 200, JSON.stringify(oldCount.body));
    await w.authTransaction((tx) =>
      tx.query("UPDATE auth_accounts SET blocked=TRUE WHERE id='manager'"),
    );
    assert.equal(
      (await call("POST", `/${doc.id}/approve`, approval)).status,
      401,
    );
  } finally {
    await app?.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
