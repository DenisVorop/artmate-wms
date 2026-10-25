import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ValidationPipe } from "@nestjs/common";
import { CreateSkuDto, WorkspaceDto } from "../src/dto";
import { WarehouseService } from "../src/warehouse.service";
import { createApp } from "../src/app";
import { cookieName } from "../src/auth.controller";
import { hashToken, randomToken } from "../src/auth-storage";
const req = () => ({ requestId: randomUUID() });
const product = () => ({
  ...req(),
  name: "Котики 2",
  barcode: "4600000000011",
});
const stock = (s: WorkspaceDto) => ({
  pallets: s.pallets,
  lots: s.lots,
  receipts: s.receipts,
  boxes: s.boxes,
  tasks: s.tasks,
  putawayTasks: s.putawayTasks,
  shipments: s.shipments,
  balance: s.balance,
});

const canonical = (s: WorkspaceDto) => ({
  ...s,
  skus: [...s.skus].sort((a, b) => a.id.localeCompare(b.id)),
});

test("standalone SKU creation is atomic, deduplicates matching barcode metadata and creates no inventory", async () => {
  const original = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  const w = new WarehouseService();
  try {
    const before = await w.snapshot();
    const ledgerBefore = await w.authTransaction(
      async (tx) =>
        (await tx.query("SELECT * FROM stock_ledger ORDER BY id")).rows,
    );
    const command = {
      ...product(),
      name: "  Котики 2  ",
      barcode: "  4600000000011  ",
      code: "  CATS-2  ",
    };
    const created = await w.createSku(command);
    const sku = created.skus.find((s) => s.barcode === "4600000000011")!;
    assert.ok(sku);
    assert.equal(sku.name, "Котики 2");
    assert.equal(sku.code, "CATS-2");
    assert.equal(sku.unitsPerBox, 20);
    assert.equal(created.skus.length, before.skus.length + 1);
    assert.equal(created.activities[0].title, "Тематика создана");
    assert.deepEqual(stock(created), stock(before));
    assert.deepEqual(await w.createSku(command), created);
    assert.deepEqual(canonical(await w.snapshot()), canonical(created));
    const duplicate = await w.createSku({ ...product(), code: "cats-2" });
    assert.deepEqual(canonical(duplicate).skus, canonical(created).skus);
    assert.deepEqual(duplicate.activities, created.activities);
    const guard = await w.snapshot();
    for (const patch of [
      { name: "Другая" },
      { unitsPerBox: 10 },
      { code: "OTHER" },
      { barcode: "NEW-CODE", code: "cats-2" },
    ])
      await assert.rejects(w.createSku({ ...product(), ...patch }));
    await assert.rejects(
      w.createSku({ ...command, name: "Changed replay" }),
      /requestId/,
    );
    assert.deepEqual(await w.snapshot(), guard);
    const auto = await w.createSku({
      ...req(),
      name: "Лисички",
      barcode: "FOXES",
      unitsPerBox: 10,
    });
    assert.match(auto.skus.find((s) => s.barcode === "FOXES")!.code, /^SKU-/);
    for (const patch of [
      { name: null },
      { name: " " },
      { name: 42 },
      { name: "x".repeat(101) },
      { barcode: null },
      { barcode: " " },
      { barcode: 123 },
      { barcode: "x".repeat(151) },
      { code: null },
      { code: " " },
      { code: "x".repeat(41) },
      { unitsPerBox: null },
      { unitsPerBox: 0 },
      { unitsPerBox: 1.2 },
      { unitsPerBox: 1001 },
      { unitsPerBox: "20" },
    ]) {
      const current = await w.snapshot();
      await assert.rejects(
        w.createSku({
          ...req(),
          name: "Invalid",
          barcode: randomUUID(),
          ...patch,
        } as never),
      );
      assert.deepEqual(await w.snapshot(), current);
    }
    assert.deepEqual(stock(await w.snapshot()), stock(before));
    assert.deepEqual(
      await w.authTransaction(
        async (tx) =>
          (await tx.query("SELECT * FROM stock_ledger ORDER BY id")).rows,
      ),
      ledgerBefore,
    );
  } finally {
    await w.onModuleDestroy();
    if (original === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = original;
  }
});

test("createSku transport DTO trims text and rejects nulls, unknowns and numeric coercion", async () => {
  const pipe = new ValidationPipe({
    expectedType: CreateSkuDto,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const parse = (body: unknown) => pipe.transform(body, { type: "body" });
  const parsed = await parse({
    ...product(),
    name: "  Котики 2 ",
    barcode: " 4600000000011 ",
    code: " CATS ",
  });
  assert.equal(parsed.name, "Котики 2");
  assert.equal(parsed.barcode, "4600000000011");
  assert.equal(parsed.code, "CATS");
  for (const patch of [
    { requestId: null },
    { name: null },
    { name: " " },
    { name: 1 },
    { name: "x".repeat(101) },
    { barcode: null },
    { barcode: " " },
    { barcode: "x".repeat(151) },
    { code: null },
    { code: " " },
    { code: "x".repeat(41) },
    { unitsPerBox: null },
    { unitsPerBox: 0 },
    { unitsPerBox: 1.1 },
    { unitsPerBox: 1001 },
    { unitsPerBox: "20" },
    { quantity: 1 },
    { newSku: {} },
    { unexpected: true },
  ])
    await assert.rejects(parse({ ...product(), ...patch }));
});

test("POST skus enforces manager session and CSRF before replay and changes only catalog", async () => {
  const original = {
    WMS_DATA_DIR: process.env.WMS_DATA_DIR,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    NODE_ENV: process.env.NODE_ENV,
  };
  const origin = "http://127.0.0.1:3080";
  process.env.WMS_DATA_DIR = "memory://";
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
    const call = async (
      body: unknown,
      role?: keyof typeof identities,
      headers: Record<string, string> = {},
    ) => {
      const identity = role ? identities[role] : undefined;
      const response = await fetch(`${base}/api/skus`, {
        method: "POST",
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
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    const before = await w.snapshot(),
      body = product();
    assert.equal((await call(body)).status, 401);
    assert.equal((await call(body, "employee")).status, 403);
    for (const headers of [
      { "X-WMS-CSRF": "" },
      { Origin: "" },
      { Origin: "https://evil.invalid" },
      { "Content-Type": "text/plain" },
    ] as Record<string, string>[])
      assert.equal((await call(body, "manager", headers)).status, 403);
    for (const patch of [
      { quantity: 2 },
      { unitsPerBox: "20" },
      { name: " " },
      { code: null },
    ])
      assert.equal((await call({ ...body, ...patch }, "manager")).status, 400);
    assert.deepEqual(await w.snapshot(), before);
    const success = await call(body, "manager");
    assert.equal(success.status, 200, JSON.stringify(success.body));
    assert.equal(success.body.skus.length, before.skus.length + 1);
    assert.deepEqual(stock(success.body), stock(before));
    assert.deepEqual((await call(body, "manager")).body, success.body);
    await w.authTransaction(async (tx) => {
      await tx.query(
        "UPDATE auth_accounts SET role='employee' WHERE id='manager'",
      );
    });
    assert.equal((await call(body, "manager")).status, 403);
    assert.deepEqual(canonical(await w.snapshot()), canonical(success.body));
  } finally {
    await app?.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
