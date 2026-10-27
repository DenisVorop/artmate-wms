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
import {
  defaultSettings,
  loadMarketplaces,
  put,
  type MarketplaceState,
} from "../src/marketplaces/storage";
import {
  activeMarketplaceResolutions,
  applyMarketplaceResolutions,
  initializeMarketplaceResolutionStorage,
  supersedePositiveStockResolutions,
  type MarketplaceResolution,
} from "../src/marketplaces/planning-resolutions";
import type { MarketplaceSupply } from "../src/marketplaces/providers/types";
const clock = new Date("2026-10-27T10:00:00Z");
const resolution = (
  patch: Partial<MarketplaceResolution> = {},
): MarketplaceResolution => ({
  id: "r1",
  kind: "zero_stock",
  provider: "wildberries",
  storeId: "store1",
  connectionVersion: 1,
  externalId: "item1",
  skuId: "sku-cats",
  enabled: true,
  note: "Подтверждено руководителем",
  confirmedAt: clock.toISOString(),
  expiresAt: "2026-11-03T10:00:00Z",
  actorAccountId: "manager1",
  revision: 1,
  ...patch,
});
const supply = (
  id: string,
  pendingUnits: number | null,
): MarketplaceSupply => ({
  id,
  statusCode: "6",
  statusLabel: "Отгружена на воротах",
  expectedAt: "2026-08-01T00:00:00Z",
  receivedAt: null,
  updatedAt: null,
  calculation: pendingUnits === null ? "review" : "document",
  warnings: pendingUnits === null ? ["Проверьте приёмку"] : [],
  items: [
    {
      externalId: "item1",
      name: "Котики",
      plannedUnits: 50,
      acceptedUnits: 0,
      readyUnits: 0,
      pendingUnits,
    },
  ],
});
const state = (): MarketplaceState => ({
  connections: [
    {
      provider: "wildberries",
      encrypted: "test",
      enabled: true,
      version: 1,
      historyStoreId: "store1",
      lastSuccessVersion: 1,
      clientId: null,
      syncStatus: "success",
      runId: null,
      lastAttemptAt: clock.toISOString(),
      lastSuccessAt: clock.toISOString(),
      message: null,
      warnings: [],
    },
  ],
  settings: defaultSettings,
  transit: {},
  mappings: [
    {
      provider: "wildberries",
      externalId: "item1",
      skuId: "sku-cats",
      unitsPerItem: 1,
    },
  ],
  snapshots: [
    {
      provider: "wildberries",
      from: "2026-10-01",
      to: "2026-10-26",
      asOf: clock.toISOString(),
      products: [{ externalId: "item1", name: "Котики", barcodes: [] }],
      stocks: [],
      demand: [],
      inbound: [
        {
          externalId: "item1",
          units: null,
          source: "wb_supplies",
          supplyIds: ["supply:lost"],
          warnings: ["Проверьте приёмку"],
        },
      ],
      supplies: [supply("supply:lost", null)],
      coverage: { catalog: true, stocks: true, demand: true, inbound: false },
      warnings: [],
    },
  ],
  resolutions: [resolution()],
});
test("confirmed missing stock is scoped, temporary, and never changes raw or numeric API observations", () => {
  const m = state(),
    before = structuredClone(m),
    projected = applyMarketplaceResolutions(m, clock);
  assert.equal(projected.snapshots[0].stocks[0].availableUnits, 0);
  assert.deepEqual(m, before);
  assert.deepEqual(applyMarketplaceResolutions(projected, clock), projected);
  assert.equal(
    applyMarketplaceResolutions(m, new Date("2026-11-04")).snapshots[0].stocks
      .length,
    0,
  );
  for (const patch of [
    { historyStoreId: "new-account" },
    { version: 2 },
    { enabled: false },
    { lastSuccessVersion: 0 },
  ]) {
    const changed = structuredClone(m);
    Object.assign(changed.connections[0], patch);
    assert.equal(
      applyMarketplaceResolutions(changed, clock).snapshots[0].stocks.length,
      0,
    );
  }
  m.snapshots[0].stocks.push({
    externalId: "item1",
    warehouseId: "api",
    warehouseName: "WB",
    availableUnits: 63,
    reservedUnits: 0,
    inboundUnits: 0,
  });
  assert.equal(
    applyMarketplaceResolutions(m, clock).snapshots[0].stocks[0].availableUnits,
    63,
  );
  m.mappings[0].skuId = "different";
  assert.equal(activeMarketplaceResolutions(m, clock).length, 0);
});
test("excluding only the burnt document restores known inbound while preserving other unknown documents and reversibility", () => {
  const m = state();
  m.resolutions = [
    resolution({
      kind: "exclude_supply",
      externalId: undefined,
      supplyId: "supply:lost",
      expiresAt: null,
    }),
  ];
  let view = applyMarketplaceResolutions(m, clock);
  assert.equal(view.snapshots[0].inbound![0].units, 0);
  assert.equal(view.snapshots[0].supplies![0].calculation, "excluded");
  assert.equal(m.snapshots[0].supplies![0].calculation, "review");
  m.snapshots[0].supplies!.push(supply("supply:new", 100));
  view = applyMarketplaceResolutions(m, clock);
  assert.equal(view.snapshots[0].inbound![0].units, 100);
  assert.deepEqual(view.snapshots[0].inbound![0].supplyIds, ["supply:new"]);
  m.snapshots[0].supplies!.push(supply("supply:unknown", null));
  assert.equal(
    applyMarketplaceResolutions(m, clock).snapshots[0].inbound![0].units,
    null,
  );
  m.resolutions![0].enabled = false;
  assert.deepEqual(
    applyMarketplaceResolutions(m, clock).snapshots,
    m.snapshots,
  );
});
test("manager resolutions are durable, replay safe, account isolated and leave warehouse/import/history unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-resolutions-")),
    previousDir = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = join(dir, "db");
  const warehouse = new WarehouseService();
  try {
    const physical = await warehouse.snapshot(),
      service = new MarketplaceService(warehouse),
      m = state();
    // Fixture clock follows actual time only for endpoint TTL assertions.
    await warehouse.authTransaction(async (tx) => {
      await tx.query(
        "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES('resolution-manager','employee-3','resolution-manager','test-only','manager',FALSE),('resolution-worker','employee-1','resolution-worker','test-only','employee',FALSE)",
      );
      await tx.query(
        "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES('resolution-manager','resolution-manager','resolution-manager','csrf',NOW()+INTERVAL '1 hour'),('resolution-worker','resolution-worker','resolution-worker','csrf',NOW()+INTERVAL '1 hour')",
      );
      await put(tx, "marketplace_connections", "wildberries", m.connections[0]);
      await put(tx, "marketplace_snapshots", "wildberries", m.snapshots[0]);
      await put(tx, "marketplace_mappings", "wb:item1", m.mappings[0]);
    });
    const manager = <T>(
      action: () => T,
      tokenHash = "resolution-manager",
      csrfToken = "csrf",
    ) =>
      requestAuth.run(
        { http: true, tokenHash, csrfToken, origin: "http://127.0.0.1:3080" },
        action,
      );
    const body = {
      requestId: randomUUID(),
      kind: "zero_stock" as const,
      provider: "wildberries" as const,
      externalId: "item1",
      enabled: true,
      note: "Фактический ноль подтверждён",
    };
    await assert.rejects(service.setMarketplaceResolution(body));
    await assert.rejects(
      manager(
        () => service.setMarketplaceResolution(body),
        "resolution-worker",
      ),
    );
    await assert.rejects(
      manager(
        () => service.setMarketplaceResolution(body),
        "resolution-manager",
        "bad",
      ),
    );
    const initial = await manager(() => service.setMarketplaceResolution(body));
    assert.equal(initial.resolutions.length, 1);
    assert.equal(initial.resolutions[0].active, true);
    assert.equal("actorAccountId" in initial.resolutions[0], false);
    assert.deepEqual(
      await manager(() => service.setMarketplaceResolution(body)),
      initial,
    );
    await assert.rejects(
      manager(() =>
        service.setMarketplaceResolution({ ...body, note: "Изменено" }),
      ),
    );
    const events = () =>
      warehouse.authTransaction((tx) =>
        tx.query<{ payload: any }>(
          "SELECT payload FROM marketplace_resolution_events ORDER BY id",
        ),
      );
    assert.equal((await events()).rows.length, 1);
    assert.equal(
      (await events()).rows[0].payload.actorAccountId,
      "resolution-manager",
    );
    await warehouse.authTransaction((tx) =>
      tx.query(
        "UPDATE auth_accounts SET role='employee' WHERE id='resolution-manager'",
      ),
    );
    await assert.rejects(manager(() => service.setMarketplaceResolution(body)));
    await warehouse.authTransaction((tx) =>
      tx.query(
        "UPDATE auth_accounts SET role='manager' WHERE id='resolution-manager'",
      ),
    );
    await assert.rejects(
      manager(() =>
        service.setMarketplaceResolution({
          ...body,
          requestId: randomUUID(),
          externalId: "other",
        }),
      ),
    );
    await assert.rejects(
      manager(() =>
        service.setMarketplaceResolution({
          ...body,
          requestId: randomUUID(),
          kind: "launch",
          donorProvider: "ozon",
        }),
      ),
    );
    await assert.rejects(
      warehouse.authTransaction((tx) =>
        tx.query(
          "UPDATE marketplace_resolution_events SET payload='{}'::jsonb",
        ),
      ),
    );
    await warehouse.authTransaction(async (tx) => {
      await initializeMarketplaceResolutionStorage(tx);
      const current = await loadMarketplaces(tx);
      assert.equal(current.resolutions!.length, 1);
      const nextSnapshot = structuredClone(m.snapshots[0]);
      nextSnapshot.stocks = [
        {
          externalId: "item1",
          warehouseId: "api",
          warehouseName: "WB",
          availableUnits: 1,
          reservedUnits: 0,
          inboundUnits: 0,
        },
      ];
      await supersedePositiveStockResolutions(
        tx,
        m.connections[0],
        nextSnapshot,
      );
      await supersedePositiveStockResolutions(
        tx,
        m.connections[0],
        nextSnapshot,
      );
      assert.equal((await loadMarketplaces(tx)).resolutions![0].enabled, false);
    });
    assert.equal((await events()).rows.length, 2);
    await warehouse.authTransaction(async (tx) => {
      await put(tx, "marketplace_connections", "wildberries", {
        ...m.connections[0],
        historyStoreId: "another-account",
      });
    });
    assert.equal(
      (await manager(() => service.getMarketplaces())).resolutions.length,
      0,
    );
    assert.deepEqual(await warehouse.snapshot(), physical);
    const raw = await warehouse.authTransaction((tx) => loadMarketplaces(tx));
    assert.deepEqual(raw.snapshots, m.snapshots);
    assert.deepEqual(raw.mappings, m.mappings);
  } finally {
    await warehouse.onModuleDestroy();
    if (previousDir === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  }
});
test("launch permission follows both mapped seller accounts and never leaks to a new donor", () => {
  const m = state();
  m.connections.push({
    ...m.connections[0],
    provider: "ozon",
    historyStoreId: "donor-store",
    version: 4,
    lastSuccessVersion: 4,
  });
  m.mappings.push({
    provider: "ozon",
    externalId: "donor-item",
    skuId: "sku-cats",
    unitsPerItem: 1,
  });
  m.resolutions = [
    resolution({
      kind: "launch",
      donorProvider: "ozon",
      donorStoreId: "donor-store",
      donorConnectionVersion: 4,
      expiresAt: null,
    }),
  ];
  assert.equal(activeMarketplaceResolutions(m, clock).length, 1);
  m.connections[1].historyStoreId = "other-store";
  assert.equal(activeMarketplaceResolutions(m, clock).length, 0);
  m.connections[1].historyStoreId = "donor-store";
  m.connections[1].version = 5;
  assert.equal(activeMarketplaceResolutions(m, clock).length, 0);
  m.connections[1].version = 4;
  m.mappings[1].skuId = "other-sku";
  assert.equal(activeMarketplaceResolutions(m, clock).length, 0);
});
test("a manager can undo existing facts after documents or donor disappear, preserving account binding", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-resolution-undo-")),
    previousDir = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = join(dir, "db");
  const warehouse = new WarehouseService();
  try {
    await warehouse.snapshot();
    const service = new MarketplaceService(warehouse),
      m = state();
    await warehouse.authTransaction(async (tx) => {
      await tx.query(
        "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES('undo-manager','employee-3','undo-manager','test-only','manager',FALSE)",
      );
      await tx.query(
        "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES('undo-manager','undo-manager','undo-manager','csrf',NOW()+INTERVAL '1 hour')",
      );
      await put(tx, "marketplace_connections", "wildberries", m.connections[0]);
      await put(tx, "marketplace_connections", "ozon", {
        ...m.connections[0],
        provider: "ozon",
        historyStoreId: "donor-account",
      });
      await put(tx, "marketplace_snapshots", "wildberries", m.snapshots[0]);
      await put(tx, "marketplace_snapshots", "ozon", {
        ...m.snapshots[0],
        provider: "ozon",
      });
      await put(tx, "marketplace_mappings", "wb:item1", m.mappings[0]);
      await put(tx, "marketplace_mappings", "ozon:item1", {
        ...m.mappings[0],
        provider: "ozon",
      });
    });
    const manager = <T>(action: () => T) =>
      requestAuth.run(
        {
          http: true,
          tokenHash: "undo-manager",
          csrfToken: "csrf",
          origin: "http://127.0.0.1:3080",
        },
        action,
      );
    const base = {
      provider: "wildberries" as const,
      enabled: true,
      note: "Подтверждённый факт",
    };
    const inputs = [
      { ...base, kind: "exclude_supply" as const, supplyId: "supply:lost" },
      { ...base, kind: "zero_stock" as const, externalId: "item1" },
      {
        ...base,
        kind: "launch" as const,
        externalId: "item1",
        donorProvider: "ozon" as const,
      },
    ];
    for (const input of inputs)
      await manager(() =>
        service.setMarketplaceResolution({ requestId: randomUUID(), ...input }),
      );
    const before = await warehouse.authTransaction((tx) =>
      loadMarketplaces(tx),
    );
    await warehouse.authTransaction(async (tx) => {
      await tx.query("DELETE FROM marketplace_snapshots");
      await tx.query("DELETE FROM marketplace_mappings");
      await tx.query("DELETE FROM marketplace_connections WHERE id='ozon'");
      await put(tx, "marketplace_connections", "wildberries", {
        ...m.connections[0],
        enabled: false,
        version: 2,
      });
    });
    const disable = (input: (typeof inputs)[number]) =>
      manager(() =>
        service.setMarketplaceResolution({
          requestId: randomUUID(),
          ...input,
          enabled: false,
          note: "Отмена руководителем",
        }),
      );
    await assert.rejects(
      disable({ ...base, kind: "zero_stock", externalId: "unknown" }),
    );
    await warehouse.authTransaction((tx) =>
      put(tx, "marketplace_connections", "wildberries", {
        ...m.connections[0],
        historyStoreId: "different-account",
      }),
    );
    await assert.rejects(disable(inputs[0]));
    await warehouse.authTransaction((tx) =>
      put(tx, "marketplace_connections", "wildberries", {
        ...m.connections[0],
        enabled: false,
        version: 2,
      }),
    );
    for (const input of inputs) await disable(input);
    const after = await warehouse.authTransaction((tx) => loadMarketplaces(tx));
    assert.equal(after.resolutions!.length, 3);
    for (const record of after.resolutions!) {
      const previous = before.resolutions!.find(
        (entry) => entry.id === record.id,
      )!;
      assert.deepEqual(record, {
        ...previous,
        enabled: false,
        note: "Отмена руководителем",
        revision: previous.revision + 1,
      });
    }
    const count = await warehouse.authTransaction((tx) =>
      tx.query("SELECT id FROM marketplace_resolution_events"),
    );
    assert.equal(count.rows.length, 6);
  } finally {
    await warehouse.onModuleDestroy();
    if (previousDir === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  }
});
test("resolution HTTP route accepts authorized manager commands and rejects anonymous, employee and missing CSRF before writing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-resolution-http-"));
  const environment = {
    WMS_DATA_DIR: process.env.WMS_DATA_DIR,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    NODE_ENV: process.env.NODE_ENV,
  };
  process.env.WMS_DATA_DIR = join(dir, "db");
  process.env.WEB_ORIGIN = "http://127.0.0.1:3080";
  process.env.NODE_ENV = "test";
  const { createApp } = await import("../src/app");
  const { cookieName } = await import("../src/auth.controller");
  const { hashToken, randomToken } = await import("../src/auth-storage");
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    app = await createApp();
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl(),
      warehouse = app.get(WarehouseService),
      m = state();
    const identities = {
      manager: { token: randomToken(), csrf: randomToken() },
      employee: { token: randomToken(), csrf: randomToken() },
    };
    await warehouse.authTransaction(async (tx) => {
      for (const role of ["manager", "employee"] as const) {
        await tx.query(
          "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES($1,$2,$1,'test-only',$3,FALSE)",
          [
            `http-resolution-${role}`,
            role === "manager" ? "employee-3" : "employee-1",
            role,
          ],
        );
        await tx.query(
          "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES($1,$1,$2,$3,NOW()+INTERVAL '1 hour')",
          [
            `http-resolution-${role}`,
            hashToken(identities[role].token),
            identities[role].csrf,
          ],
        );
      }
      await put(tx, "marketplace_connections", "wildberries", m.connections[0]);
      await put(tx, "marketplace_connections", "ozon", {
        ...m.connections[0],
        provider: "ozon",
        historyStoreId: "donor-account",
      });
      await put(tx, "marketplace_snapshots", "wildberries", m.snapshots[0]);
      await put(tx, "marketplace_snapshots", "ozon", {
        ...m.snapshots[0],
        provider: "ozon",
      });
      await put(tx, "marketplace_mappings", "wb:item1", m.mappings[0]);
      await put(tx, "marketplace_mappings", "ozon:item1", {
        ...m.mappings[0],
        provider: "ozon",
      });
    });
    const command = {
      requestId: randomUUID(),
      provider: "wildberries",
      kind: "zero_stock",
      externalId: "item1",
      enabled: true,
      note: "Руководитель подтвердил отсутствие товара",
    };
    const call = async (
      body: unknown,
      role?: keyof typeof identities,
      csrf = true,
    ) => {
      const identity = role ? identities[role] : undefined;
      const response = await fetch(`${base}/api/marketplaces/resolutions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:3080",
          "X-WMS-Request": "1",
          ...(identity ? { Cookie: `${cookieName()}=${identity.token}` } : {}),
          ...(identity && csrf ? { "X-WMS-CSRF": identity.csrf } : {}),
        },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        body: await response.json(),
        headers: response.headers,
      };
    };
    assert.equal((await call(command)).status, 401);
    assert.equal((await call(command, "employee")).status, 403);
    assert.equal((await call(command, "manager", false)).status, 403);
    assert.equal(
      (await call({ ...command, unexpected: true }, "manager")).status,
      400,
    );
    assert.equal(
      (await warehouse.authTransaction((tx) => loadMarketplaces(tx)))
        .resolutions!.length,
      0,
    );
    const saved = await call(command, "manager");
    assert.equal(
      saved.status,
      200,
      "the manager controller operation must be admitted by the global AuthGuard",
    );
    assert.equal(saved.headers.get("cache-control"), "no-store");
    assert.equal(saved.body.resolutions[0].kind, "zero_stock");
    assert.equal(saved.body.resolutions[0].active, true);
    for (const entry of [
      { kind: "exclude_supply", supplyId: "supply:lost" },
      { kind: "launch", externalId: "item1", donorProvider: "ozon" },
    ]) {
      const result = await call(
        {
          requestId: randomUUID(),
          provider: "wildberries",
          enabled: true,
          note: "Уточнение для планирования",
          ...entry,
        },
        "manager",
      );
      assert.equal(result.status, 200, `${entry.kind} HTTP command`);
    }
    assert.deepEqual((await call(command, "manager")).body, saved.body);
    const events = await warehouse.authTransaction((tx) =>
      tx.query("SELECT id FROM marketplace_resolution_events"),
    );
    assert.equal(events.rows.length, 3);
    await warehouse.authTransaction((tx) =>
      tx.query(
        "UPDATE auth_accounts SET role='employee' WHERE id='http-resolution-manager'",
      ),
    );
    assert.equal(
      (await call(command, "manager")).status,
      403,
      "revoked role cannot replay an earlier success",
    );
  } finally {
    if (app) await app.close();
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
