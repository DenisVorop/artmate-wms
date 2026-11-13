import "reflect-metadata";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createApp } from "../src/app";
import { WarehouseService } from "../src/warehouse.service";
import * as D from "../src/dto";
const req = () => ({ requestId: randomUUID() }),
  origin = "http://127.0.0.1:3080";
type Browser = { cookie: string; csrf: string; user: D.AuthUserDto };
let app: Awaited<ReturnType<typeof createApp>>,
  w: WarehouseService,
  base: string,
  manager: Browser,
  worker: Browser,
  other: Browser,
  pg: Client | undefined,
  schema: string | undefined;
let receiving: D.WorkZoneDto,
  assembly: D.WorkZoneDto,
  putaway: D.WorkZoneDto,
  shipping: D.WorkZoneDto;
let skuId: string, taskId: string, secondTaskId: string, firstBox: D.BoxDto;
async function call(
  method: string,
  path: string,
  body?: unknown,
  actor: Browser | null | undefined = manager,
) {
  const r = await fetch(`${base}/api/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "X-WMS-Request": "1",
      ...(actor ? { Cookie: actor.cookie, "X-WMS-CSRF": actor.csrf } : {}),
    },
    ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  return {
    status: r.status,
    body: await r.json(),
    cookie: r.headers.get("set-cookie"),
  };
}
function session(r: Awaited<ReturnType<typeof call>>): Browser {
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return {
    cookie: r.cookie!.split(";")[0],
    csrf: r.body.csrfToken,
    user: r.body.user,
  };
}
async function ok(
  path: string,
  body: unknown,
  actor = manager,
): Promise<D.WorkspaceDto> {
  const r = await call("POST", path, body, actor);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
const code = (z: D.WorkZoneDto) => `artmate-wms:work-zone:${z.id}`;
const binding = (s: D.WorkspaceDto, a = worker) =>
  s.warehouse.zoneWork.find((x) => x.employeeId === a.user.employeeId)!;
const start = (z: D.WorkZoneDto, a = worker) =>
  ok(
    "work-zones/start",
    { ...req(), employeeId: a.user.employeeId, zoneCode: code(z) },
    a,
  );
const leave = (a = worker) =>
  ok("work-zones/leave", { ...req(), employeeId: a.user.employeeId }, a);
async function zone(kind: string, locationIds: string[]) {
  const s = await ok("work-zones", {
    ...req(),
    code: "",
    name: "",
    kind,
    locationIds,
  });
  return s.warehouse.workZones.at(-1)!;
}
async function newRaw(unitsPerBox = 1, quantity = 10) {
  const before = await w.snapshot();
  const s = await w.createReceipt({
    ...req(),
    receivedAt: "2026-10-24T08:00:00.000Z",
    pallets: [
      {
        newSku: {
          name: `QR товар ${randomUUID()}`,
          barcode: randomUUID(),
          unitsPerBox,
        },
        quantity,
        widthMm: 1200,
        depthMm: 800,
        heightMm: 800,
      },
    ],
  });
  const r = s.receipts.find(
      (r) => !before.receipts.some((x) => x.id === r.id),
    )!,
    p = s.pallets.find((p) => p.id === r.pallets[0].palletId)!;
  const loc = (await w.getReceiptPlacementOptions(r.id, p.id)).locations[0];
  assert(loc);
  const out = await w.placeReceiptPallet(r.id, p.id, {
    ...req(),
    employeeId: manager.user.employeeId,
    palletCode: p.code,
    locationCode: loc.code,
  });
  return { skuId: p.skuId!, pallet: out.pallets.find((x) => x.id === p.id)! };
}
async function createTask(boxesTarget: number) {
  const before = await w.snapshot();
  const s = await w.createTask({
    ...req(),
    skuId,
    employeeId: worker.user.employeeId,
    boxesTarget,
  });
  return s.tasks.find((t) => !before.tasks.some((x) => x.id === t.id))!;
}
async function scanTask(
  id: string,
  kind: "source" | "box" | "barcode",
  value: string,
) {
  return ok(
    `tasks/${id}/scan`,
    { ...req(), employeeId: worker.user.employeeId, kind, value },
    worker,
  );
}
before(async () => {
  process.env.NODE_ENV = "test";
  process.env.WEB_ORIGIN = origin;
  const url = process.env.WMS_ZONE_TEST_DATABASE_URL;
  if (url) {
    if (!new URL(url).pathname.endsWith("_test"))
      throw new Error("Only isolated _test database allowed");
    pg = new Client({ connectionString: url });
    await pg.connect();
    schema = `zones_${randomUUID().replaceAll("-", "")}`;
    await pg.query(`CREATE SCHEMA ${schema}`);
    const scoped = new URL(url);
    scoped.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = scoped.toString();
    delete process.env.WMS_DATA_DIR;
  } else process.env.WMS_DATA_DIR = "memory://";
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  w = app.get(WarehouseService);
  manager = session(
    await call(
      "POST",
      "auth/setup",
      {
        name: "Руководитель зон",
        login: "zones-manager",
        password: "Zones-Manager-Password1",
      },
      null,
    ),
  );
  await ok(`employees/${manager.user.employeeId}/shift`, {
    ...req(),
    status: "working",
  });
  await w.updateWarehousePlan({ ...req(), width: 100, depth: 100 });
  for (let i = 0; i < 12; i++)
    await w.createLocation({
      ...req(),
      code: `ZONE-F-${i}`,
      name: `Место ${i}`,
      kind: "floor",
      levels: 1,
      x: 30 + i * 3,
      y: 30,
      width: 2,
      depth: 2,
      maxHeightMm: 2500,
      maxBoxes: 36,
      availableWidthMm: 1400,
      availableDepthMm: 1000,
      maxWeightKg: null,
      accessSides: 4,
    });
  async function account(login: string) {
    const before = await w.snapshot();
    const s = await w.createEmployee({
      ...req(),
      name: login,
      role: "Кладовщик",
    });
    const e = s.employees.find(
      (e) => !before.employees.some((x) => x.id === e.id),
    )!;
    assert.equal(
      (
        await call("POST", "auth/accounts", {
          employeeId: e.id,
          login,
          role: "employee",
          password: "Temporary-Password1",
        })
      ).status,
      200,
    );
    const temporary = session(
      await call(
        "POST",
        "auth/login",
        { login, password: "Temporary-Password1" },
        null,
      ),
    );
    const a = session(
      await call(
        "POST",
        "auth/change-password",
        {
          currentPassword: "Temporary-Password1",
          newPassword: "Permanent-Password2",
        },
        temporary,
      ),
    );
    await ok(`employees/${e.id}/shift`, { ...req(), status: "working" }, a);
    return a;
  }
  worker = await account("zones-worker");
  other = await account("zones-other");
});
after(async () => {
  await app?.close();
  if (pg && schema) {
    await pg.query(`DROP SCHEMA ${schema} CASCADE`);
    await pg.end();
  }
});
test("work-zone DTO, auto identity, separate stable QR, strict null/partial updates and archive restore", async () => {
  assert.equal((await call("GET", "workspace", undefined, null)).status, 401);
  assert.equal(
    (
      await call(
        "POST",
        "work-zones",
        {
          ...req(),
          code: "",
          name: "",
          kind: "receiving",
          locationIds: ["loc-receiving"],
        },
        worker,
      )
    ).status,
    403,
  );
  receiving = await zone("receiving", ["loc-receiving"]);
  assembly = await zone("assembly", ["loc-assembly"]);
  putaway = await zone("putaway", ["loc-assembly"]);
  shipping = await zone("shipping", ["loc-shipping"]);
  assert.equal(receiving.code, "WZ-01");
  assert.equal(receiving.name, "Зона приёмки 1");
  for (const body of [
    { ...req(), code: null },
    { ...req(), name: "" },
    { ...req(), locationIds: null },
    { ...req(), kind: null },
    { ...req(), extra: 1 },
  ])
    assert.equal(
      (await call("POST", `work-zones/${receiving.id}`, body)).status,
      400,
    );
  let s = await ok(`work-zones/${receiving.id}`, {
    ...req(),
    name: "Главная приёмка",
  });
  assert.equal(
    s.warehouse.workZones.find((z) => z.id === receiving.id)!.code,
    receiving.code,
  );
  const label = (await call("GET", `labels/work-zone/${receiving.id}`)).body;
  assert.equal(label.payload, code(receiving));
  assert.equal(label.title, "Приёмка · Главная приёмка");
  assert.notEqual(label.payload, "artmate-wms:location:loc-receiving");
  for (const zoneCode of [
    "loc-receiving",
    "artmate-wms:location:loc-receiving",
    receiving.code,
  ])
    assert.equal(
      (
        await call(
          "POST",
          "work-zones/start",
          { ...req(), employeeId: worker.user.employeeId, zoneCode },
          worker,
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await call(
        "POST",
        "work-zones/start",
        {
          ...req(),
          employeeId: other.user.employeeId,
          zoneCode: code(receiving),
        },
        worker,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("POST", "work-zones", {
        ...req(),
        code: "",
        name: "",
        kind: "assembly",
        locationIds: ["loc-assembly-2"],
      })
    ).status,
    400,
  );
  const spare = await zone("receiving", ["loc-receiving"]);
  await ok(`work-zones/${spare.id}/archive`, req());
  assert.equal(
    (
      await call(
        "POST",
        "work-zones/start",
        { ...req(), employeeId: worker.user.employeeId, zoneCode: code(spare) },
        worker,
      )
    ).status,
    400,
  );
  s = await ok(`work-zones/${spare.id}/restore`, req());
  assert.equal(
    s.warehouse.workZones.find((z) => z.id === spare.id)!.id,
    spare.id,
  );
  assert.equal(
    (await call("GET", `labels/work-zone/${spare.id}`)).body.payload,
    code(spare),
  );
});
test("receiving claims are atomic per pallet, actor protected, QR never admits stock, place selects next in one command and shift releases reservations", async () => {
  await w.createReceipt({
    ...req(),
    receivedAt: "2020-01-01T09:00:00Z",
    pallets: Array.from({ length: 3 }, () => ({
      skuId: "sku-space",
      quantity: 10,
      widthMm: 1200,
      depthMm: 800,
      heightMm: 800,
    })),
  });
  const before = await w.snapshot(),
    ledger = (await w.getStockLedger({})).summary.eventsCount;
  const [one, two] = await Promise.all([
    start(receiving),
    start(receiving, other),
  ]);
  const a = binding(one),
    b = binding(two, other);
  assert.equal(a.jobKind, "receiving");
  assert.notEqual(a.palletId, b.palletId);
  assert.equal(one.warehouse.zoneWork.length, 1);
  assert.deepEqual(one.balance, before.balance);
  assert.equal((await w.getStockLedger({})).summary.eventsCount, ledger);
  const wrong = await call(
    "POST",
    `receipts/${b.jobId}/pallets/${b.palletId}/place`,
    {
      ...req(),
      employeeId: worker.user.employeeId,
      palletCode: before.pallets.find((p) => p.id === b.palletId)!.code,
      locationCode: "ZONE-F-0",
    },
    worker,
  );
  assert.equal(wrong.status, 403, JSON.stringify(wrong.body));
  const p = before.pallets.find((p) => p.id === a.palletId)!,
    loc = (await w.getReceiptPlacementOptions(a.jobId!, p.id)).locations[0],
    body = {
      ...req(),
      employeeId: worker.user.employeeId,
      palletCode: p.code,
      locationCode: loc.code,
    };
  const placed = await ok(
    `receipts/${a.jobId}/pallets/${p.id}/place`,
    body,
    worker,
  );
  assert.equal(placed.balance.rawUnits, before.balance.rawUnits + 10);
  assert.notEqual(binding(placed).palletId, p.id);
  assert.notEqual(binding(placed).palletId, b.palletId);
  assert.equal(binding(placed).jobId, a.jobId);
  const replay = await ok(
    `receipts/${a.jobId}/pallets/${p.id}/place`,
    body,
    worker,
  );
  assert.equal(replay.revision, placed.revision);
  assert.equal((await w.snapshot()).revision, placed.revision);
  assert.equal(
    (await call("POST", `work-zones/${receiving.id}/archive`, req())).status,
    400,
  );
  await ok(
    `employees/${worker.user.employeeId}/shift`,
    { ...req(), status: "break" },
    worker,
  );
  const paused = await w.snapshot();
  assert.equal(binding(paused).jobId, null);
  assert.equal(
    (
      await call(
        "POST",
        "work-zones/start",
        {
          ...req(),
          employeeId: worker.user.employeeId,
          zoneCode: code(receiving),
        },
        worker,
      )
    ).status,
    403,
  );
  await ok(
    `employees/${worker.user.employeeId}/shift`,
    { ...req(), status: "working" },
    worker,
  );
  assert.equal(binding(await w.snapshot()).jobId, null);
  await leave(other);
  await leave();
});
test("assembly resumes, WIP prevents switch/leave, global accumulator remains fixed and the next box stays unclaimed", async () => {
  skuId = (await newRaw()).skuId;
  const task = await createTask(1);
  taskId = task.id;
  secondTaskId = (await createTask(1)).id;
  let s = await start(assembly);
  assert.equal(binding(s).jobId, taskId);
  const t = s.tasks.find((t) => t.id === taskId)!,
    source = s.pallets.find((p) => p.id === t.reservations[0].palletId)!;
  await scanTask(taskId, "source", source.code);
  await scanTask(taskId, "box", t.openBoxCode);
  const before = await w.snapshot();
  assert.equal(
    (
      await call(
        "POST",
        "work-zones/start",
        {
          ...req(),
          employeeId: worker.user.employeeId,
          zoneCode: code(receiving),
        },
        worker,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "POST",
        "work-zones/leave",
        { ...req(), employeeId: worker.user.employeeId },
        worker,
      )
    ).status,
    400,
  );
  assert.deepEqual(await w.snapshot(), before);
  s = await start(assembly);
  assert.equal(binding(s).jobId, taskId);
  s = await scanTask(
    taskId,
    "barcode",
    s.skus.find((x) => x.id === skuId)!.barcode,
  );
  firstBox = s.boxes.find((b) => b.code === t.openBoxCode)!;
  assert.equal(firstBox.locationId, "loc-assembly");
  assert.equal(
    s.pallets.filter((p) => p.kind === "assembly" && p.status !== "retired")
      .length,
    1,
  );
  assert.equal(binding(s).jobId, null);
  assert.equal(s.tasks.find((t) => t.id === secondTaskId)!.status, "queued");
  s = await start(putaway);
  assert.equal(s.tasks.find((t) => t.id === taskId)!.status, "completed");
  assert.equal(binding(s).jobKind, null);
  assert.equal(binding(s).jobId, null);
});
test("putaway carry resumes only same zone, blocks switch/shift, place autoadvances once without creating extra inventory", async () => {
  let s = await w.snapshot(),
    t = s.putawayTasks.find((t) => t.boxId === firstBox.id)!;
  const before = s.balance.totalUnits;
  const take = {
    ...req(),
    employeeId: worker.user.employeeId,
    boxCode: firstBox.code,
  };
  for (const [body, actor, status] of [
    [{ ...take, requestId: randomUUID(), boxCode: "WRONG" }, worker, 400],
    [{ ...take, requestId: randomUUID() }, other, 403],
    [{ ...take, requestId: randomUUID(), locationCode: "fake" }, worker, 400],
  ] as const) {
    const unchanged = await w.snapshot();
    assert.equal(
      (await call("POST", "putaway-tasks/take-box", body, actor)).status,
      status,
    );
    assert.deepEqual(await w.snapshot(), unchanged);
  }
  s = await ok("putaway-tasks/take-box", take, worker);
  assert.deepEqual(await ok("putaway-tasks/take-box", take, worker), s);
  t = s.putawayTasks.find((task) => task.id === t.id)!;
  const dest = s.locations.find((l) => l.id === t.toLocationId)!;
  assert.equal(s.boxes.find((b) => b.id === firstBox.id)!.status, "in_transit");
  assert.equal(s.balance.totalUnits, before);
  await start(putaway, other);
  const foreignBefore = await w.snapshot();
  assert.equal(
    (
      await call(
        "POST",
        "putaway-tasks/take-box",
        { ...req(), employeeId: other.user.employeeId, boxCode: firstBox.code },
        other,
      )
    ).status,
    403,
  );
  assert.deepEqual(await w.snapshot(), foreignBefore);
  const resumed = await start(putaway);
  assert.equal(binding(resumed).jobId, t.id);
  assert.equal(
    (
      await call(
        "POST",
        "work-zones/start",
        {
          ...req(),
          employeeId: worker.user.employeeId,
          zoneCode: code(receiving),
        },
        worker,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "POST",
        `employees/${worker.user.employeeId}/shift`,
        { ...req(), status: "off" },
        worker,
      )
    ).status,
    400,
  );
  const place = {
    ...req(),
    employeeId: worker.user.employeeId,
    locationCode: dest.code,
  };
  for (const [body, actor, status] of [
    [{ ...place, requestId: randomUUID(), locationCode: "WRONG" }, worker, 400],
    [{ ...place, requestId: randomUUID() }, other, 403],
    [
      { ...place, requestId: randomUUID(), boxCode: firstBox.code },
      worker,
      400,
    ],
  ] as const) {
    const unchanged = await w.snapshot();
    assert.equal(
      (await call("POST", `putaway-tasks/${t.id}/place-box`, body, actor))
        .status,
      status,
    );
    assert.deepEqual(await w.snapshot(), unchanged);
  }
  s = await ok(`putaway-tasks/${t.id}/place-box`, place, worker);
  assert.deepEqual(
    await ok(`putaway-tasks/${t.id}/place-box`, place, worker),
    s,
  );
  const rows = await w.authTransaction((tx) =>
    tx.query(
      "SELECT * FROM work_events WHERE kind='putaway_box_placed' AND source_id=$1",
      [t.id],
    ),
  );
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].employee_id, worker.user.employeeId);
  await ok(
    `employees/${worker.user.employeeId}/shift`,
    { ...req(), status: "break" },
    worker,
  );
  const afterBreak = await w.snapshot();
  for (const [path, body] of [
    ["take-box", take],
    ["place-box", place],
  ] as const) {
    assert.equal(
      (
        await call(
          "POST",
          path === "take-box"
            ? "putaway-tasks/take-box"
            : `putaway-tasks/${t.id}/${path}`,
          body,
          worker,
        )
      ).status,
      403,
    );
    assert.deepEqual(await w.snapshot(), afterBreak);
  }
  await ok(
    `employees/${worker.user.employeeId}/shift`,
    { ...req(), status: "working" },
    worker,
  );
  assert.equal(binding(s).jobId, null);
  assert.equal(s.balance.totalUnits, before);
  s = await start(assembly);
  assert.equal(binding(s).jobId, secondTaskId);
  const task = s.tasks.find((t) => t.id === secondTaskId)!,
    p = s.pallets.find((p) => p.id === task.reservations[0].palletId)!;
  await scanTask(secondTaskId, "source", p.code);
  await scanTask(secondTaskId, "box", task.openBoxCode);
  s = await scanTask(
    secondTaskId,
    "barcode",
    s.skus.find((x) => x.id === skuId)!.barcode,
  );
  assert.equal(s.tasks.find((t) => t.id === secondTaskId)!.status, "completed");
  assert.equal(binding(s).jobId, null);
});
test("box picking scans FIFO reservations at storage, updates the pallet, and ships only on manager confirmation", async () => {
  let s = await w.snapshot();
  const pallet = s.pallets.find(
    (p) => p.id === s.boxes.find((b) => b.id === firstBox.id)!.palletId,
  )!;
  const prior = s.shipments.map((x) => x.id);
  s = await w.createShipment({ ...req(), skuId, boxesRequested: 1 });
  const draft = s.shipments.find((x) => !prior.includes(x.id))!;
  assert.deepEqual(draft.boxIds, [firstBox.id]);
  await leave();
  const free = await call("GET", "workspace", undefined, worker);
  assert(free.body.shipments.some((x: D.ShipmentDto) => x.id === draft.id));
  const base = `shipments/${draft.id}`;
  s = await ok(
    `${base}/work/claim`,
    { ...req(), employeeId: worker.user.employeeId },
    worker,
  );
  assert.equal(
    s.shipments.find((x) => x.id === draft.id)!.employeeId,
    worker.user.employeeId,
  );
  assert(!s.warehouse.zoneWork.length);
  assert.equal((await call("POST", `${base}/ship`, req())).status, 400);
  assert.equal(
    (
      await call(
        "POST",
        `${base}/work/claim`,
        { ...req(), employeeId: other.user.employeeId },
        other,
      )
    ).status,
    403,
  );
  const scan = {
    ...req(),
    employeeId: worker.user.employeeId,
    boxCode: `artmate-wms:box:${firstBox.code}`,
  };
  assert.equal(
    (
      await call(
        "POST",
        `${base}/work/scan`,
        { ...scan, ...req(), boxCode: "WRONG" },
        worker,
      )
    ).status,
    400,
  );
  const balance = s.balance.totalUnits;
  s = await ok(`${base}/work/scan`, scan, worker);
  assert.equal(s.shipments.find((x) => x.id === draft.id)!.status, "draft");
  assert.deepEqual(s.shipments.find((x) => x.id === draft.id)!.scannedBoxIds, [
    firstBox.id,
  ]);
  const box = s.boxes.find((b) => b.id === firstBox.id)!;
  assert.equal(box.status, "staged");
  assert.equal(box.locationId, null);
  assert.equal(box.palletId, null);
  assert.equal(
    s.pallets.find((p) => p.id === pallet.id)!.quantity,
    pallet.quantity - 1,
  );
  assert.equal(s.balance.totalUnits, balance);
  assert.equal(
    (await ok(`${base}/work/scan`, scan, worker)).revision,
    s.revision,
  );
  assert.equal(
    (await call("POST", `${base}/work/scan`, { ...scan, ...req() }, worker))
      .status,
    400,
  );
  assert.equal((await call("POST", `${base}/ship`, req(), worker)).status, 403);
  assert.equal(
    (
      await call(
        "POST",
        `${base}/work/finish`,
        {
          ...req(),
          employeeId: worker.user.employeeId,
          zoneCode: code(shipping),
        },
        worker,
      )
    ).status,
    400,
  );
  const staged = await leave();
  assert.equal(
    staged.shipments.some((x) => x.id === draft.id && x.status === "shipped"),
    false,
  );
  const ship = req();
  const out = await ok(`${base}/ship`, ship);
  assert.equal(out.balance.totalUnits, balance - firstBox.units);
  assert.equal(out.shipments.find((x) => x.id === draft.id)!.status, "shipped");
  assert.equal((await ok(`${base}/ship`, ship)).revision, out.revision);
  const ledger = await w.getStockLedger({});
  const events = ledger.items.filter((e) => e.referenceId === draft.id);
  assert.equal(events.find((e) => e.kind === "shipment_pick")?.unitsDelta, 0);
  assert.equal(
    events.find((e) => e.kind === "shipment_pick")?.employeeId,
    worker.user.employeeId,
  );
  assert.equal(
    events.find((e) => e.kind === "shipment")?.unitsDelta,
    -firstBox.units,
  );
  assert.equal(ledger.summary.reconciled, true);
});

test("shipping QR takes distinct reservations concurrently, pause preserves picks and session revocation precedes replay", async () => {
  let s = await w.createLocation({
    ...req(),
    code: "ZONE-SHIP-2",
    name: "Отгрузка 2",
    kind: "shipping",
    levels: 1,
    x: 70,
    y: 30,
    width: 2,
    depth: 2,
    maxHeightMm: 2500,
    maxBoxes: 36,
    availableWidthMm: 1400,
    availableDepthMm: 1000,
    maxWeightKg: null,
    accessSides: 4,
  });
  const loc = s.locations.find((l) => l.code === "ZONE-SHIP-2")!;
  s = await ok(`work-zones/${shipping.id}`, {
    ...req(),
    locationIds: ["loc-shipping", loc.id],
  });
  shipping = s.warehouse.workZones.find((z) => z.id === shipping.id)!;
  const pallet = s.pallets.find(
    (p) => p.kind === "finished" && p.skuId === "sku-space" && p.quantity >= 3,
  )!;
  const from = s.locations.find((l) => l.id === pallet.locationId)!;
  s = await w.createMovement({
    ...req(),
    palletId: pallet.id,
    toLocationId: loc.id,
    employeeId: manager.user.employeeId,
    kind: "transfer",
  });
  const move = s.movements.find(
    (m) => m.palletId === pallet.id && m.status === "planned",
  )!;
  await w.takeMovement(move.id, {
    ...req(),
    palletCode: pallet.code,
    locationCode: from.code,
  });
  await w.placeMovement(move.id, {
    ...req(),
    palletCode: pallet.code,
    locationCode: loc.code,
  });
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const before = await w.snapshot();
    s = await w.createShipment({
      ...req(),
      skuId: "sku-space",
      boxesRequested: 1,
    });
    ids.push(
      s.shipments.find((x) => !before.shipments.some((old) => old.id === x.id))!
        .id,
    );
  }
  const [one, two] = await Promise.all([
      start(shipping),
      start(shipping, other),
    ]),
    a = binding(one),
    b = binding(two, other);
  assert(ids.includes(a.jobId!));
  assert(ids.includes(b.jobId!));
  assert.notEqual(a.jobId, b.jobId);
  assert.equal(one.warehouse.zoneWork.length, 1);
  assert(!one.shipments.some((x) => x.employeeId === other.user.employeeId));
  const box = one.boxes.find(
    (x) => x.id === one.shipments.find((x) => x.id === a.jobId)!.boxIds[0],
  )!;
  const scan = {
    ...req(),
    employeeId: worker.user.employeeId,
    boxCode: box.code,
  };
  await ok(`shipments/${a.jobId}/work/scan`, scan, worker);
  // Legacy manual endpoints remain available: a physical carry must still block shipping execution.
  const state = await w.snapshot(),
    queued = state.putawayTasks.find((t) => t.status === "queued")!;
  assert(queued);
  let carrying = await ok(
    `putaway-tasks/${queued.id}/claim`,
    { ...req(), employeeId: worker.user.employeeId },
    worker,
  );
  await ok(
    `putaway-tasks/${queued.id}/release`,
    { ...req(), employeeId: worker.user.employeeId },
    worker,
  );
  assert.equal(binding(await w.snapshot()).jobId, a.jobId);
  carrying = await ok(
    `putaway-tasks/${queued.id}/claim`,
    { ...req(), employeeId: worker.user.employeeId },
    worker,
  );
  const claimed = carrying.putawayTasks.find((t) => t.id === queued.id)!,
    carriedBox = carrying.boxes.find((b) => b.id === queued.boxId)!,
    fromLocation = carrying.locations.find(
      (l) => l.id === claimed.fromLocationId,
    )!,
    toLocation = carrying.locations.find((l) => l.id === claimed.toLocationId)!;
  await ok(
    `putaway-tasks/${queued.id}/take`,
    {
      ...req(),
      employeeId: worker.user.employeeId,
      boxCode: carriedBox.code,
      locationCode: fromLocation.code,
    },
    worker,
  );
  assert.equal(
    (
      await call(
        "POST",
        `shipments/${a.jobId}/work/finish`,
        {
          ...req(),
          employeeId: worker.user.employeeId,
          zoneCode: code(shipping),
        },
        worker,
      )
    ).status,
    400,
  );
  await ok(
    `putaway-tasks/${queued.id}/place`,
    {
      ...req(),
      employeeId: worker.user.employeeId,
      boxCode: carriedBox.code,
      locationCode: toLocation.code,
    },
    worker,
  );
  await ok(
    `employees/${worker.user.employeeId}/shift`,
    { ...req(), status: "break" },
    worker,
  );
  assert.equal(binding(await w.snapshot()).jobId, a.jobId);
  assert.equal(
    (await call("POST", `shipments/${a.jobId}/work/scan`, scan, worker)).status,
    403,
  );
  await ok(
    `employees/${worker.user.employeeId}/shift`,
    { ...req(), status: "working" },
    worker,
  );
  const beforeEvents = (await w.getWorkHistory({})).total;
  s = await ok(`shipments/${a.jobId}/ship`, req());
  assert.equal(binding(s).jobId, null);
  assert.equal((await w.getWorkHistory({})).total, beforeEvents);
  s = await start(shipping);
  const next = binding(s);
  assert(next.jobId && next.jobId !== a.jobId && next.jobId !== b.jobId);
  assert.equal(
    (
      await call("POST", `work-zones/${shipping.id}`, {
        ...req(),
        locationIds: [loc.id],
      })
    ).status,
    400,
  );
  const account = (await call("GET", "auth/accounts")).body.items.find(
    (x: D.AuthAccountDto) => x.employeeId === worker.user.employeeId,
  );
  await call("POST", `auth/accounts/${account.id}/revoke-sessions`, {});
  assert.equal(
    (await call("POST", `shipments/${a.jobId}/work/scan`, scan, worker)).status,
    401,
  );
});

test("unbound legacy WIP can resume at assembly QR without losing scans, but another zone cannot silently switch it", async () => {
  const raw = await newRaw(2, 10),
    before = await w.snapshot();
  let s = await w.createTask({
    ...req(),
    skuId: raw.skuId,
    employeeId: manager.user.employeeId,
    boxesTarget: 1,
  });
  const task = s.tasks.find(
    (t) => !before.tasks.some((old) => old.id === t.id),
  )!;
  await ok(`tasks/${task.id}/claim`, {
    ...req(),
    employeeId: manager.user.employeeId,
  });
  await ok(`tasks/${task.id}/scan`, {
    ...req(),
    employeeId: manager.user.employeeId,
    kind: "source",
    value: raw.pallet.code,
  });
  await ok(`tasks/${task.id}/scan`, {
    ...req(),
    employeeId: manager.user.employeeId,
    kind: "box",
    value: task.openBoxCode,
  });
  await ok(`tasks/${task.id}/scan`, {
    ...req(),
    employeeId: manager.user.employeeId,
    kind: "barcode",
    value: s.skus.find((x) => x.id === raw.skuId)!.barcode,
  });
  assert.equal(
    (
      await call("POST", "work-zones/start", {
        ...req(),
        employeeId: manager.user.employeeId,
        zoneCode: code(receiving),
      })
    ).status,
    400,
  );
  s = await start(assembly, manager);
  assert.equal(binding(s, manager).jobId, task.id);
  assert.equal(s.tasks.find((t) => t.id === task.id)!.scannedUnits, 1);
  assert.equal(
    s.tasks.find((t) => t.id === task.id)!.openBoxCode,
    task.openBoxCode,
  );
});

test("completion preserves its result when another paused task has an unavailable source", async () => {
  const before = await w.snapshot();
  let s = await w.createEmployee({
    ...req(),
    name: "Legacy queue actor",
    role: "Кладовщик",
  });
  const employeeId = s.employees.find(
    (e) => !before.employees.some((old) => old.id === e.id),
  )!.id;
  await w.updateShift(employeeId, { ...req(), status: "working" });
  const firstRaw = await newRaw(1, 5),
    secondRaw = await newRaw(1, 5);
  s = await w.createTask({
    ...req(),
    skuId: firstRaw.skuId,
    employeeId,
    boxesTarget: 1,
  });
  const paused = s.tasks.find((t) => t.skuId === firstRaw.skuId)!;
  await w.startZoneWork({ ...req(), employeeId, zoneCode: code(assembly) });
  await w.updateTaskStatus(paused.id, {
    ...req(),
    employeeId,
    status: "paused",
  });
  s = await w.createTask({
    ...req(),
    skuId: secondRaw.skuId,
    employeeId,
    boxesTarget: 1,
  });
  const current = s.tasks.find((t) => t.skuId === secondRaw.skuId)!;
  // Only the fixture uses raw SQL: this represents an imported pre-existing blocked address.
  await w.authTransaction(async (tx) => {
    await tx.query(
      "UPDATE locations SET payload=jsonb_set(payload,'{blocked}','true'::jsonb) WHERE id=$1",
      [firstRaw.pallet.locationId],
    );
  });
  await w.claimTask(current.id, { ...req(), employeeId });
  await w.scanTask(current.id, {
    ...req(),
    employeeId,
    kind: "source",
    value: secondRaw.pallet.code,
  });
  await w.scanTask(current.id, {
    ...req(),
    employeeId,
    kind: "box",
    value: current.openBoxCode,
  });
  s = await w.scanTask(current.id, {
    ...req(),
    employeeId,
    kind: "barcode",
    value: s.skus.find((x) => x.id === secondRaw.skuId)!.barcode,
  });
  assert.equal(s.tasks.find((t) => t.id === current.id)!.status, "completed");
  assert(s.boxes.some((b) => b.code === current.openBoxCode));
  const idle = s.warehouse.zoneWork.find((x) => x.employeeId === employeeId)!;
  assert.equal(idle.jobId, null);
  assert.match(idle.message, /Возьмите следующее/);
  await w.updateLocation(firstRaw.pallet.locationId!, {
    ...req(),
    blocked: false,
  });
  s = await w.startZoneWork({ ...req(), employeeId, zoneCode: code(assembly) });
  assert.equal(
    s.warehouse.zoneWork.find((x) => x.employeeId === employeeId)!.jobId,
    paused.id,
  );
});

test("one WB document retains the FIFO reservation, requires its owner and three scans, and binds each label once", async () => {
  let s = await w.snapshot();
  const source = await w.createShipment({
    ...req(),
    skuId: "sku-space",
    boxesRequested: 1,
  });
  const reserved = source.shipments.find(
    (row) => !s.shipments.some((old) => old.id === row.id),
  )!;
  const reservedBox = source.boxes.find(
    (box) => box.id === reserved.boxIds[0],
  )!;
  const labels = [1, 2].map((i) => ({
    id: String(i),
    code: `$Wb;Label;${i};TAS`,
    skuId: reservedBox.skuId,
    units: reservedBox.units,
  }));
  const manifest = async () => ({
    storeId: "test",
    labels: structuredClone(labels),
  });
  const body = { ...req(), supplyId: "4567", sourceShipmentIds: [reserved.id] };
  s = await w.importWbShipment(body, manifest);
  const job = s.shipments.find((row) => row.wb?.supplyId === body.supplyId)!;
  assert(job.boxIds.includes(reservedBox.id));
  assert.equal(
    s.shipments.some((row) => row.id === reserved.id),
    false,
  );
  assert.equal(job.employeeId, null);
  assert.equal(job.boxIds.length, 2);
  await assert.rejects(
    w.importWbShipment({ ...body, ...req() }, manifest),
    /уже есть/,
  );
  const account = other;
  const priorZone = s.warehouse.zoneWork.find(
    (row) => row.employeeId === account.user.employeeId,
  );
  if (priorZone) await leave(account);
  const base = `shipments/${job.id}`;
  const claim = (actor: Browser) =>
    call(
      "POST",
      `${base}/work/claim`,
      { ...req(), employeeId: actor.user.employeeId },
      actor,
    );
  const claimed = await claim(account);
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  assert.equal((await claim(manager)).status, 403);
  const pick = (boxCode: string, actor = account) =>
    call(
      "POST",
      `${base}/work/scan`,
      { ...req(), employeeId: actor.user.employeeId, boxCode },
      actor,
    );
  const first = s.boxes.find((box) => box.id === job.boxIds[0])!;
  const location = s.locations.find((item) => item.id === first.locationId)!;
  assert.equal((await pick(first.code)).status, 400);
  assert.equal((await pick(location.code, manager)).status, 403);
  assert.equal((await pick(`Artmate-wms:location:${location.id}`)).status, 200);
  const boxScan = await pick(first.code);
  assert.equal(boxScan.status, 200);
  assert.equal(
    boxScan.body.boxes.find((box: D.BoxDto) => box.id === first.id).status,
    "stored",
  );
  assert.equal((await pick("$Wb;Wrong;TAS")).status, 400);
  const labelScan = await pick(labels[0].code);
  assert.equal(labelScan.status, 200, JSON.stringify(labelScan.body));
  assert.equal(labelScan.body.balance.totalUnits, s.balance.totalUnits);
  await leave(account);
  assert.equal((await claim(manager)).status, 403);
  const reassign = await ok(`${base}/work/assign`, {
    ...req(),
    employeeId: manager.user.employeeId,
  });
  const state = reassign.shipments.find((row) => row.id === job.id)!;
  assert.deepEqual(state.scannedBoxIds, [first.id]);
  assert.equal(state.wb!.labels[0].employeeId, account.user.employeeId);
  assert.equal((await pick(labels[1].code)).status, 403);
  const second = reassign.boxes.find((box) => box.id === job.boxIds[1])!;
  const nextAddress = reassign.locations.find(
    (item) => item.id === second.locationId,
  )!;
  assert.equal((await pick(nextAddress.code, manager)).status, 200);
  assert.equal((await pick(second.code, manager)).status, 200);
  assert.equal((await pick(labels[0].code, manager)).status, 400);
  const finished = await pick(labels[1].code, manager);
  assert.equal(finished.status, 200, JSON.stringify(finished.body));
  assert.equal(finished.body.balance.totalUnits, s.balance.totalUnits);
  assert.equal(
    finished.body.shipments.find((row: D.ShipmentDto) => row.id === job.id)
      .status,
    "draft",
  );
});
