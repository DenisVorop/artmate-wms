import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WarehouseService } from "../src/warehouse.service";
import { PalletLabelService } from "../src/pallet-label.service";
import { BoxLabelService } from "../src/box-label.service";
import { requestAuth, RequestAuthContext } from "../src/auth-context";
const req = () => ({ requestId: randomUUID() });
const origin = "http://127.0.0.1:3080";
const context = (id: string): RequestAuthContext => ({
  http: true,
  tokenHash: `pallet-labels-${id}`,
  csrfToken: `csrf-${id}`,
  origin,
});
const as = <T>(id: string, fn: () => T) => requestAuth.run(context(id), fn);
async function accounts(w: WarehouseService) {
  await w.authTransaction(async (tx) => {
    for (const [id, employee, role] of [
      ["manager", "employee-3", "manager"],
      ["one", "employee-1", "employee"],
      ["two", "employee-2", "employee"],
    ]) {
      await tx.query(
        "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES($1,$2,$1,'test-only',$3,FALSE)",
        [id, employee, role],
      );
      await tx.query(
        "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES($1,$1,$2,$3,NOW()+INTERVAL '1 hour')",
        [id, `pallet-labels-${id}`, `csrf-${id}`],
      );
    }
  });
}
async function incoming(w: WarehouseService) {
  const before = await w.snapshot();
  const state = await w.createReceipt({
    ...req(),
    receivedAt: "2000-01-01T09:00:00Z",
    pallets: [
      {
        skuId: "sku-cats",
        quantity: 40,
        widthMm: 1200,
        depthMm: 800,
        heightMm: 720,
      },
    ],
  });
  const receipt = state.receipts.find(
    (r) => !before.receipts.some((old) => old.id === r.id),
  )!;
  return {
    receipt,
    pallet: state.pallets.find((p) => p.id === receipt.pallets[0].palletId)!,
  };
}
async function histories(w: WarehouseService) {
  return w.authTransaction(async (tx) => ({
    ledger: (await tx.query("SELECT * FROM stock_ledger ORDER BY id")).rows,
    work: (await tx.query("SELECT * FROM work_events ORDER BY id")).rows,
  }));
}

test("pallet reserve has no stock; raced permanent binding survives restart, placement and FIFO assembly", async () => {
  const previous = process.env.WMS_DATA_DIR,
    dir = await mkdtemp(join(tmpdir(), "wms-pallet-label-"));
  process.env.WMS_DATA_DIR = join(dir, "db");
  let w: WarehouseService | undefined;
  try {
    w = new WarehouseService();
    await w.snapshot();
    await accounts(w);
    await w.updateWarehousePlan({ ...req(), width: 100, depth: 100 });
    await w.createLocation({
      ...req(),
      kind: "floor",
      levels: 1,
      availableWidthMm: 1200,
      availableDepthMm: 800,
      name: "Приёмочный тестовый адрес",
      code: "RECEIPT-TEST",
      x: 50,
      y: 30,
      width: 2,
      depth: 2,
      maxHeightMm: 2000,
      maxBoxes: 42,
    });
    let labels = new PalletLabelService(w);
    const before = await w.snapshot(),
      beforeHistory = await histories(w),
      body = { ...req(), count: 1000 };
    await assert.rejects(
      as("one", () => labels.createPalletLabelBatch(body)),
      /руководителя/,
    );
    for (const count of [0, 1001, 1.5])
      await assert.rejects(
        as("manager", () => labels.createPalletLabelBatch({ ...req(), count })),
        /1000/,
      );
    const batch = await as("manager", () =>
      labels.createPalletLabelBatch(body),
    );
    assert.equal(batch.freeCount, 1000);
    assert.deepEqual(await w.snapshot(), before);
    assert.deepEqual(await histories(w), beforeHistory);
    assert.deepEqual(
      await as("manager", () => labels.createPalletLabelBatch(body)),
      batch,
    );
    await assert.rejects(
      w.updateWarehousePlan({ ...body, name: "collision" }),
      /requestId/,
    );
    await assert.rejects(
      as("manager", () => new BoxLabelService(w!).createBoxLabelBatch(body)),
      /requestId/,
    );
    const page = await as("manager", () =>
      labels.getPalletLabelBatchLabels(batch.id, {
        pageSize: 100,
        status: "free",
      }),
    );
    assert.equal(page.items.length, 100);
    assert.equal(page.total, 1000);
    assert.equal(page.items[0].ordinal, 1);
    assert.equal(page.items[99].ordinal, 100);
    const label = page.items[0],
      other = page.items[1];
    assert.equal(label.payload, `artmate-wms:pallet:${label.code}`);
    assert.match(label.svg, /<svg/);
    const one = await incoming(w),
      two = await incoming(w),
      balanceBefore = (await w.snapshot()).balance,
      historiesBefore = await histories(w);
    const bind = (
      item: typeof one,
      employeeId: string,
      labelCode: string,
      requestId = randomUUID(),
    ) =>
      w!.bindReceiptPalletLabel(item.receipt.id, item.pallet.id, {
        requestId,
        employeeId,
        labelCode,
      });
    for (const bad of [
      "PLT-PRE-unknown",
      `artmate-wms:pallet:${other.id}`,
      "artmate-wms:box:" + label.code,
      "artmate-wms:location:" + label.code,
    ])
      await assert.rejects(
        as("one", () => bind(one, "employee-1", bad)),
        /не зарегистрирована/,
      );
    await assert.rejects(
      as("two", () => bind(one, "employee-1", label.payload)),
      /другого сотрудника/,
    );
    const raced = await Promise.allSettled([
      as("one", () => bind(one, "employee-1", label.payload)),
      as("two", () => bind(two, "employee-2", label.code)),
    ]);
    assert.equal(raced.filter((r) => r.status === "fulfilled").length, 1);
    const after = await w.snapshot(),
      owner = after.pallets.find((p) => p.code === label.code)!;
    assert(owner);
    const selected = owner.id === one.pallet.id ? one : two,
      loser = selected === one ? two : one,
      employeeId = selected === one ? "employee-1" : "employee-2",
      actor = selected === one ? "one" : "two";
    assert.deepEqual(after.balance, balanceBefore);
    assert.deepEqual(await histories(w), historiesBefore);
    assert.equal(
      after.receipts.find((r) => r.id === selected.receipt.id)!.status,
      "awaiting_placement",
    );
    assert.equal(owner.id, selected.pallet.id);
    await assert.rejects(
      bind(loser, employeeId, label.code),
      /другой паллетой/,
    );
    await assert.rejects(
      bind(selected, employeeId, other.code),
      /уже есть этикетка/,
    );
    const replayId = randomUUID(),
      replayed = await as(actor, () =>
        bind(selected, employeeId, label.payload, replayId),
      );
    assert.deepEqual(
      await as(actor, () =>
        bind(selected, employeeId, label.payload, replayId),
      ),
      replayed,
    );
    await w.updateShift(employeeId, { ...req(), status: "break" });
    await assert.rejects(
      as(actor, () => bind(selected, employeeId, label.payload, replayId)),
      /смен/,
    );
    await w.updateShift(employeeId, { ...req(), status: "working" });
    assert.equal(
      (await as("manager", () => labels.getPalletLabelBatch(batch.id)))
        .freeCount,
      999,
    );
    await w.onModuleDestroy();
    w = new WarehouseService();
    await w.snapshot();
    labels = new PalletLabelService(w);
    assert.equal(
      (await w.snapshot()).pallets.find((p) => p.id === owner.id)!.code,
      label.code,
    );
    const location = (await w.snapshot()).locations.find(
      (l) => l.code === "RECEIPT-TEST",
    )!;
    const placed = await as(actor, () =>
      w!.placeReceiptPallet(selected.receipt.id, owner.id, {
        ...req(),
        employeeId,
        palletCode: label.payload,
        locationCode: `artmate-wms:location:${location.id}`,
      }),
    );
    assert.equal(placed.balance.rawUnits, balanceBefore.rawUnits + 40);
    assert.equal(
      (await w.snapshot()).receipts.find((r) => r.id === selected.receipt.id)!
        .status,
      "completed",
    );
    await assert.rejects(
      bind(selected, employeeId, other.code),
      /уже размещена/,
    );
    const created = await w.createTask({
        ...req(),
        skuId: "sku-cats",
        boxesTarget: 1,
        employeeId,
      }),
      task = created.tasks.find(
        (t) => !placed.tasks.some((x) => x.id === t.id),
      )!;
    await as(actor, () => w!.claimTask(task.id, { ...req(), employeeId }));
    const scanned = await as(actor, () =>
      w!.scanTask(task.id, {
        ...req(),
        employeeId,
        kind: "source",
        value: label.payload,
      }),
    );
    assert.equal(
      scanned.tasks.find((t) => t.id === task.id)!.sourcePalletId,
      owner.id,
    );
    await as(actor, () =>
      w!.scanTask(task.id, {
        ...req(),
        employeeId,
        kind: "source",
        value: `artmate-wms:pallet:${owner.id}`,
      }),
    );
    const assigned = await as("manager", () =>
      labels.getPalletLabelBatchLabels(batch.id, { status: "assigned" }),
    );
    assert.equal(assigned.total, 1);
    assert.equal(assigned.items[0].palletId, owner.id);
    assert.equal(assigned.items[0].receiptId, selected.receipt.id);
  } finally {
    await w?.onModuleDestroy();
    await rm(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
  }
});

test("binding cannot steal receiving claim and failed commit rolls back the registry", async () => {
  const previous = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  let w: WarehouseService | undefined;
  try {
    w = new WarehouseService();
    await w.snapshot();
    await accounts(w);
    const labels = new PalletLabelService(w),
      batch = await as("manager", () =>
        labels.createPalletLabelBatch({ ...req(), count: 2 }),
      ),
      page = await as("manager", () =>
        labels.getPalletLabelBatchLabels(batch.id, {}),
      ),
      item = await incoming(w);
    const zoneState = await w.createWorkZone({
        ...req(),
        kind: "receiving",
        code: "",
        name: "",
        locationIds: ["loc-receiving"],
      }),
      zone = zoneState.warehouse.workZones.find((z) => z.kind === "receiving")!;
    await as("one", () =>
      w!.startZoneWork({
        ...req(),
        employeeId: "employee-1",
        zoneCode: `artmate-wms:work-zone:${zone.id}`,
      }),
    );
    await assert.rejects(
      as("two", () =>
        w!.bindReceiptPalletLabel(item.receipt.id, item.pallet.id, {
          ...req(),
          employeeId: "employee-2",
          labelCode: page.items[0].payload,
        }),
      ),
      /другим сотрудником/,
    );
    const before = await w.snapshot(),
      original = (w as any)._assertIntegrity;
    (w as any)._assertIntegrity = () => {
      throw Error("Injected commit failure");
    };
    try {
      await assert.rejects(
        as("one", () =>
          w!.bindReceiptPalletLabel(item.receipt.id, item.pallet.id, {
            ...req(),
            employeeId: "employee-1",
            labelCode: page.items[0].payload,
          }),
        ),
        /Injected/,
      );
    } finally {
      (w as any)._assertIntegrity = original;
    }
    assert.deepEqual(await w.snapshot(), before);
    assert.equal(
      (await as("manager", () => labels.getPalletLabelBatch(batch.id)))
        .freeCount,
      2,
    );
    await as("one", () =>
      w!.bindReceiptPalletLabel(item.receipt.id, item.pallet.id, {
        ...req(),
        employeeId: "employee-1",
        labelCode: page.items[0].payload,
      }),
    );
  } finally {
    await w?.onModuleDestroy();
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
  }
});

test("schema19 adds empty pallet registry only and preserves every existing table and replay", async () => {
  const previous = process.env.WMS_DATA_DIR,
    dir = await mkdtemp(join(tmpdir(), "wms-pallet-label-migration-"));
  process.env.WMS_DATA_DIR = join(dir, "db");
  let w: WarehouseService | undefined;
  try {
    w = new WarehouseService();
    const command = { ...req(), name: "Before pallet reserve" },
      cached = await w.updateWarehousePlan(command);
    await accounts(w);
    const before = await w.snapshot();
    await w.onModuleDestroy();
    w = undefined;
    const { PGlite } = await import("@electric-sql/pglite"),
      db = new PGlite(process.env.WMS_DATA_DIR);
    await db.waitReady;
    await db.exec(
      "DROP TABLE pallet_label_commands;DROP TABLE preprinted_pallet_labels;DROP TABLE pallet_label_batches;UPDATE metadata SET value='18' WHERE key='schema_version'",
    );
    const tables = (
        await db.query<{ tablename: string }>(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'metadata' ORDER BY tablename",
        )
      ).rows.map((r) => r.tablename),
      saved = new Map();
    for (const table of tables)
      saved.set(
        table,
        (await db.query("SELECT * FROM " + table + " ORDER BY 1")).rows,
      );
    const metadata = (
      await db.query(
        "SELECT * FROM metadata WHERE key<>'schema_version' ORDER BY key",
      )
    ).rows;
    await db.close();
    w = new WarehouseService();
    assert.deepEqual(await w.snapshot(), before);
    assert.deepEqual(await w.updateWarehousePlan(command), cached);
    await w.authTransaction(async (tx) => {
      for (const table of tables)
        assert.deepEqual(
          (await tx.query("SELECT * FROM " + table + " ORDER BY 1")).rows,
          saved.get(table),
          table,
        );
      assert.deepEqual(
        (
          await tx.query(
            "SELECT * FROM metadata WHERE key<>'schema_version' ORDER BY key",
          )
        ).rows,
        metadata,
      );
      assert.equal(
        (
          await tx.query<{ value: string }>(
            "SELECT value FROM metadata WHERE key='schema_version'",
          )
        ).rows[0].value,
        "19",
      );
      for (const table of [
        "pallet_label_commands",
        "preprinted_pallet_labels",
        "pallet_label_batches",
      ])
        assert.equal((await tx.query("SELECT * FROM " + table)).rows.length, 0);
    });
  } finally {
    await w?.onModuleDestroy();
    await rm(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
  }
});

test("HTTP pallet-label endpoints enforce manager permissions, CSRF, strict DTO and bounded query paging", async () => {
  const previous = process.env.WMS_DATA_DIR,
    previousOrigin = process.env.WEB_ORIGIN,
    previousNode = process.env.NODE_ENV;
  process.env.WMS_DATA_DIR = "memory://";
  process.env.WEB_ORIGIN = origin;
  process.env.NODE_ENV = "test";
  const { createApp } = await import("../src/app"),
    { hashToken } = await import("../src/auth-storage"),
    { cookieName } = await import("../src/auth.controller");
  const app = await createApp();
  try {
    const w = app.get(WarehouseService);
    await accounts(w);
    const managerToken = "M".repeat(43),
      workerToken = "W".repeat(43);
    await w.authTransaction(async (tx) => {
      await tx.query(
        "UPDATE auth_sessions SET token_hash=$1 WHERE id='manager'",
        [hashToken(managerToken)],
      );
      await tx.query("UPDATE auth_sessions SET token_hash=$1 WHERE id='one'", [
        hashToken(workerToken),
      ]);
    });
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const call = async (
      path: string,
      body?: unknown,
      actor: "manager" | "worker" | "anonymous" = "manager",
      extra: Record<string, string> = {},
    ) => {
      const response = await fetch(`${base}/api/pallet-label-batches${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          ...(actor === "anonymous"
            ? {}
            : {
                Cookie: `${cookieName()}=${actor === "manager" ? managerToken : workerToken}`,
                "X-WMS-CSRF": actor === "manager" ? "csrf-manager" : "csrf-one",
              }),
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    };
    const body = { ...req(), count: 3 };
    assert.equal((await call("", undefined, "anonymous")).status, 401);
    assert.equal((await call("", body, "worker")).status, 403);
    assert.equal(
      (await call("", body, "manager", { "X-WMS-CSRF": "wrong" })).status,
      403,
    );
    for (const invalid of [
      { ...body, count: 1001 },
      { ...body, count: null },
      { ...body, count: 1.5 },
      { ...body, count: "3" },
      { ...body, employeeId: "spoof" },
    ])
      assert.equal((await call("", invalid)).status, 400);
    const created = await call("", body);
    assert.equal(created.status, 200);
    assert.equal(created.body.count, 3);
    assert.equal((await call("", body)).body.id, created.body.id);
    for (const path of [
      "",
      `/${created.body.id}`,
      `/${created.body.id}/labels`,
    ])
      assert.equal((await call(path, undefined, "worker")).status, 403);
    const page = await call(
      `/${created.body.id}/labels?pageSize=2&status=free`,
    );
    assert.equal(page.status, 200);
    assert.equal(page.body.items.length, 2);
    assert.equal(page.body.total, 3);
    for (const query of ["pageSize=101", "page=0", "status=wrong", "unknown=1"])
      assert.equal(
        (await call(`/${created.body.id}/labels?${query}`)).status,
        400,
      );
    assert.equal((await call("/missing")).status, 404);
    const receipt = await incoming(w),
      label = page.body.items[0];
    const bindPath = `${base}/api/receipts/${receipt.receipt.id}/pallets/${receipt.pallet.id}/label`;
    const bindBody = {
      ...req(),
      employeeId: "employee-1",
      labelCode: label.payload,
    };
    const bindCall = async (
      value: unknown,
      headers: Record<string, string> = {},
    ) => {
      const response = await fetch(bindPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          Cookie: `${cookieName()}=${workerToken}`,
          "X-WMS-CSRF": "csrf-one",
          ...headers,
        },
        body: JSON.stringify(value),
      });
      return { status: response.status, body: await response.json() };
    };
    const stockBefore = (await w.snapshot()).balance;
    assert.equal((await bindCall(bindBody, { Cookie: "" })).status, 401);
    assert.equal(
      (await bindCall(bindBody, { "X-WMS-CSRF": "wrong" })).status,
      403,
    );
    assert.equal(
      (await bindCall({ ...bindBody, employeeId: "employee-2" })).status,
      403,
    );
    assert.equal((await bindCall({ ...bindBody, extra: true })).status, 400);
    assert.equal(
      (await bindCall({ ...bindBody, labelCode: "PLT-PRE-UNKNOWN" })).status,
      400,
    );
    const bound = await bindCall(bindBody);
    assert.equal(
      bound.status,
      200,
      "new bind operation must pass the real global HTTP AuthGuard",
    );
    assert.equal(
      bound.body.pallets.find((p: any) => p.id === receipt.pallet.id).code,
      label.code,
    );
    assert.deepEqual((await w.snapshot()).balance, stockBefore);
    assert.equal((await bindCall(bindBody)).status, 200);
    await w.updateShift("employee-1", { ...req(), status: "break" });
    assert.equal(
      (await bindCall(bindBody)).status,
      403,
      "fresh working-shift check before replay",
    );
    await w.updateShift("employee-1", { ...req(), status: "working" });
    const zoneState = await w.createWorkZone({
      ...req(),
      kind: "receiving",
      code: "",
      name: "",
      locationIds: ["loc-receiving"],
    });
    await w.startZoneWork({
      ...req(),
      employeeId: "employee-2",
      zoneCode: `artmate-wms:work-zone:${
        zoneState.warehouse.workZones.find((z) => z.kind === "receiving")!.id
      }`,
    });
    assert.equal(
      (
        await bindCall({
          ...bindBody,
          requestId: randomUUID(),
          labelCode: page.body.items[1].payload,
        })
      ).status,
      403,
      "foreign receiving claim checked before replay or mutation",
    );

    assert.equal(
      (await call("", body, "manager", { Origin: "http://evil.invalid" }))
        .status,
      403,
    );
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
    if (previousOrigin === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = previousOrigin;
    if (previousNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNode;
  }
});
