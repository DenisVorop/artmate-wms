import "reflect-metadata";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createApp } from "../src/app";
import { WarehouseService } from "../src/warehouse.service";
import { stocktakePlan, stocktakeRow } from "../src/stocktake-plan";
import { Queryable } from "../src/database";
import * as D from "../src/dto";
const req = () => ({ requestId: randomUUID() });
const origin = "http://127.0.0.1:3080";
type Browser = { cookie: string; csrf: string; user: D.AuthUserDto };
let app: Awaited<ReturnType<typeof createApp>>,
  w: WarehouseService,
  base: string,
  manager: Browser,
  worker: Browser,
  other: Browser,
  pg: Client | undefined,
  schema: string | undefined;
const sql = () => (w as unknown as { db: Queryable }).db;
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
): Promise<D.StocktakeDto> {
  const r = await call("POST", path, body, actor);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
async function get(id: string, actor = manager): Promise<D.StocktakeDto> {
  const r = await call("GET", `stocktakes/${id}`, undefined, actor);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
async function doc(ids: string[], actor = manager) {
  let d = await ok("stocktakes", { ...req(), locationIds: ids });
  return ok(
    `stocktakes/${d.id}/claim`,
    { ...req(), expectedRevision: d.revision },
    actor,
  );
}
async function count(
  d: D.StocktakeDto,
  id: string,
  rawPallets: D.StocktakeRawCountDto[] = [],
  boxCodes: string[] = [],
  actor = manager,
) {
  const row = d.rows.find((r) => r.locationId === id)!;
  return ok(
    `stocktakes/${d.id}/rows/${id}/count`,
    {
      ...req(),
      expectedRevision: d.revision,
      locationCode: `artmate-wms:location:${id}`,
      rawPallets,
      boxCodes,
    },
    actor,
  );
}
async function submit(d: D.StocktakeDto, actor = manager) {
  return ok(
    `stocktakes/${d.id}/submit`,
    { ...req(), expectedRevision: d.revision },
    actor,
  );
}
async function approve(d: D.StocktakeDto) {
  return ok(`stocktakes/${d.id}/approve`, {
    ...req(),
    expectedRevision: d.revision,
    reason: "Подтверждено фактическим пересчётом",
  });
}
async function location(code: string, x: number) {
  const s = await w.createLocation({
    ...req(),
    code,
    name: code,
    kind: "floor",
    levels: 1,
    x,
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
  return s.locations.find((l) => l.code === code)!;
}
async function rawAt(l: D.LocationDto, qty = 100) {
  const s = await w.createReceipt({
    ...req(),
    receivedAt: "2020-03-04T09:00:00.000Z",
    pallets: [
      {
        skuId: "sku-cats",
        quantity: qty,
        widthMm: 1200,
        depthMm: 800,
        heightMm: 800,
      },
    ],
  });
  const receipt = s.receipts.at(-1)!,
    p = s.pallets.find((p) => p.id === receipt.pallets[0].palletId)!;
  const placed = await w.placeReceiptPallet(receipt.id, p.id, {
    ...req(),
    employeeId: manager.user.employeeId,
    palletCode: p.code,
    locationCode: l.code,
  });
  return placed.pallets.find((x) => x.id === p.id)!;
}
before(async () => {
  process.env.NODE_ENV = "test";
  process.env.WEB_ORIGIN = origin;
  const url = process.env.WMS_STOCKTAKE_TEST_DATABASE_URL;
  if (url) {
    if (!new URL(url).pathname.endsWith("_test"))
      throw new Error("Only isolated _test DB allowed");
    pg = new Client({ connectionString: url });
    await pg.connect();
    schema = `stocktake_${randomUUID().replaceAll("-", "")}`;
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
        name: "Руководитель сверки",
        login: "stock-manager",
        password: "Stocktake-Manager-Password1",
      },
      undefined,
    ),
  );
  await w.updateWarehousePlan({ ...req(), width: 100, depth: 100 });
  await call("POST", `employees/${manager.user.employeeId}/shift`, {
    ...req(),
    status: "working",
  });
  async function user(login: string) {
    const s = await w.createEmployee({
      ...req(),
      name: login,
      role: "Кладовщик",
    });
    const e = s.employees.at(-1)!;
    const r = await call("POST", "auth/accounts", {
      employeeId: e.id,
      login,
      role: "employee",
      password: "Temporary-Password1",
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const temp = session(
      await call(
        "POST",
        "auth/login",
        { login, password: "Temporary-Password1" },
        undefined,
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
        temp,
      ),
    );
    assert.equal(
      (
        await call(
          "POST",
          `employees/${e.id}/shift`,
          { ...req(), status: "working" },
          a,
        )
      ).status,
      200,
    );
    return a;
  }
  worker = await user("counter-one");
  other = await user("counter-two");
});
after(async () => {
  await app?.close();
  if (pg && schema) {
    await pg.query(`DROP SCHEMA ${schema} CASCADE`);
    await pg.end();
  }
});
test("HTTP strict DTO, default deny and manager-only creation", async () => {
  assert.equal((await call("GET", "stocktakes", undefined, null)).status, 401);
  assert.equal(
    (
      await call(
        "POST",
        "stocktakes",
        { ...req(), locationIds: ["loc-1"] },
        worker,
      )
    ).status,
    403,
  );
  for (const body of [
    { ...req(), locationIds: [] },
    { ...req(), locationIds: null },
    { ...req(), locationIds: ["loc-1"], extra: true },
    { ...req(), locationIds: ["loc-assembly"] },
    { ...req(), locationIds: ["loc-1", "loc-1"] },
  ])
    assert.equal((await call("POST", "stocktakes", body)).status, 400);
});
test("raw approval is atomic, preserves FIFO/receipt and empty physical pallet, replay has one adjustment and no work events", async () => {
  const l = await location("ST-RAW", 30),
    p = await rawAt(l),
    before = await w.snapshot(),
    workBefore = (await sql().query("SELECT id FROM work_events")).rows.length;
  let d = await doc([l.id]);
  const countBody = {
    ...req(),
    expectedRevision: d.revision,
    locationCode: l.code,
    rawPallets: [{ palletCode: `artmate-wms:pallet:${p.id}`, quantity: 80 }],
    boxCodes: [],
  };
  d = await ok(`stocktakes/${d.id}/rows/${l.id}/count`, countBody);
  assert.equal(
    (await w.snapshot()).pallets.find((x) => x.id === p.id)!.quantity,
    100,
  );
  d = await submit(d);
  const body = {
    ...req(),
    expectedRevision: d.revision,
    reason: "Фактическая недостача при пересчёте",
  };
  const approved = await ok(`stocktakes/${d.id}/approve`, body);
  const after = await w.snapshot();
  assert.equal(after.pallets.find((x) => x.id === p.id)!.quantity, 80);
  assert.equal(after.pallets.find((x) => x.id === p.id)!.lotId, p.lotId);
  assert.deepEqual(after.receipts, before.receipts);
  assert.equal(
    after.lots.find((x) => x.id === p.lotId)!.receivedAt,
    "2020-03-04T09:00:00.000Z",
  );
  assert.deepEqual(await ok(`stocktakes/${d.id}/approve`, body), approved);
  assert.equal((await w.snapshot()).revision, after.revision);
  const events = (await w.getStockLedger({})).items.filter(
    (e) => e.referenceId === d.id,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "adjustment");
  assert.equal(events[0].referenceType, "stocktake");
  assert.equal(events[0].employeeId, manager.user.employeeId);
  assert.equal(events[0].unitsDelta, -20);
  assert.equal(
    (await sql().query("SELECT id FROM work_events")).rows.length,
    workBefore,
  );
  await w.adjustStock({
    ...req(),
    kind: "raw_count",
    targetId: p.id,
    employeeId: manager.user.employeeId,
    expectedLocationId: l.id,
    expectedQuantity: 80,
    countedQuantity: 81,
    reason: "Поздняя отдельная корректировка",
  });
  assert.deepEqual((await get(d.id)).preview, approved.preview);
  let zero = await doc([l.id]);
  zero = await count(zero, l.id);
  zero = await submit(zero);
  await approve(zero);
  const empty = (await w.snapshot()).pallets.find((x) => x.id === p.id)!;
  assert.equal(empty.quantity, 0);
  assert.equal(empty.locationId, l.id);
  assert.equal(empty.status, "stored");
});
test("paired raw relocation requires source omission and both counted addresses; preserves IDs lot and quantity", async () => {
  const a = await location("ST-SOURCE", 33),
    b = await location("ST-TARGET", 36),
    p = await rawAt(a);
  let d = await doc([a.id, b.id]);
  d = await count(d, a.id, []);
  d = await count(d, b.id, [{ palletCode: p.code, quantity: 100 }]);
  assert.equal(d.preview.issues.length, 0, JSON.stringify(d.preview));
  d = await submit(d);
  const result = await approve(d);
  assert.equal(result.preview.changes[0].kind, "raw_pallet_relocation");
  const moved = (await w.snapshot()).pallets.find((x) => x.id === p.id)!;
  assert.equal(moved.locationId, b.id);
  assert.equal(moved.quantity, 100);
  assert.equal(moved.lotId, p.lotId);
  const event = (await w.getStockLedger({})).items.find(
    (e) => e.referenceId === d.id,
  )!;
  assert.equal(event.unitsDelta, 0);
  assert.equal(event.lines.length, 2);
  let outside = await doc([a.id]);
  outside = await count(outside, a.id, [{ palletCode: p.code, quantity: 100 }]);
  assert(outside.preview.issues.some((i) => i.code === "OUTSIDE_SCOPE"));
});
test("worker ownership, revision conflict, unknown codes, aliases duplicate and review refresh history", async () => {
  const l = await location("ST-WORKER", 39),
    p = await rawAt(l);
  let d = await doc([l.id], worker);
  assert.equal(
    (await call("GET", `stocktakes/${d.id}`, undefined, other)).status,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        `stocktakes/${d.id}/rows/${l.id}/count`,
        {
          ...req(),
          expectedRevision: d.revision,
          locationCode: l.code,
          rawPallets: [],
          boxCodes: [],
        },
        other,
      )
    ).status,
    403,
  );
  d = await count(
    d,
    l.id,
    [
      { palletCode: p.code, quantity: 100 },
      { palletCode: `artmate-wms:pallet:${p.id}`, quantity: 100 },
    ],
    ["artmate-wms:box:UNKNOWN"],
    worker,
  );
  assert(d.preview.issues.some((i) => i.code === "DUPLICATE_PALLET"));
  assert(d.preview.issues.some((i) => i.code === "UNKNOWN_BOX"));
  d = await submit(d, worker);
  assert.equal(d.status, "review");
  assert.equal(
    (
      await call("POST", `stocktakes/${d.id}/approve`, {
        ...req(),
        expectedRevision: d.revision,
        reason: "Нельзя принять неизвестные коды",
      })
    ).status,
    409,
  );
  const prev = d.rows[0].count;
  d = await ok(`stocktakes/${d.id}/rows/${l.id}/refresh`, {
    ...req(),
    expectedRevision: d.revision,
  });
  assert.equal(d.status, "counting");
  assert.equal(d.rows[0].count, null);
  assert.deepEqual(
    [...d.history].reverse().find((h) => h.kind === "refreshed")!.previousRow!
      .count,
    prev,
  );
  const old = d.revision;
  d = await count(d, l.id, [{ palletCode: p.code, quantity: 100 }], [], worker);
  assert.equal(
    (
      await call(
        "POST",
        `stocktakes/${d.id}/submit`,
        { ...req(), expectedRevision: old },
        worker,
      )
    ).status,
    409,
  );
  const report = await call("GET", "performance", undefined, worker);
  assert.equal(report.status, 200, JSON.stringify(report.body));
  assert(
    report.body.employees[0].currentJobs.some(
      (j: any) => j.kind === "stocktake" && j.id === d.id,
    ),
  );
  await ok(`stocktakes/${d.id}/cancel`, {
    ...req(),
    expectedRevision: d.revision,
    reason: "Отменена после проверки расхождения",
  });
});
test("cell epochs catch reserve-release and out-and-back, refresh clears one row; requestId target and namespaces are distinct", async () => {
  const a = await location("ST-EPOCH-A", 42),
    b = await location("ST-EPOCH-B", 45),
    p = await rawAt(a);
  let d = await doc([a.id, b.id]);
  d = await count(d, a.id, [{ palletCode: p.code, quantity: 100 }]);
  d = await count(d, b.id);
  const before = d.rows.find((r) => r.locationId === a.id)!.currentVersion;
  let s = await w.createMovement({
    ...req(),
    palletId: p.id,
    toLocationId: b.id,
    employeeId: manager.user.employeeId,
    kind: "transfer",
  });
  const m = s.movements.at(-1)!;
  await w.cancelMovement(m.id, req());
  d = await get(d.id);
  assert(d.rows.find((r) => r.locationId === a.id)!.stale);
  assert(
    d.rows.find((r) => r.locationId === a.id)!.currentVersion >= before + 2,
  );
  assert.equal(
    (
      await call("POST", `stocktakes/${d.id}/submit`, {
        ...req(),
        expectedRevision: d.revision,
      })
    ).status,
    409,
  );
  const refresh = { ...req(), expectedRevision: d.revision };
  d = await ok(`stocktakes/${d.id}/rows/${a.id}/refresh`, refresh);
  assert.equal(
    (await call("POST", `stocktakes/${d.id}/rows/${b.id}/refresh`, refresh))
      .status,
    409,
  );
  assert(d.rows.find((r) => r.locationId === b.id)!.count);
  const namespace = req();
  await w.updateWarehousePlan({ ...namespace, width: 100, depth: 100 });
  assert.equal(
    (await call("POST", "stocktakes", { ...namespace, locationIds: [a.id] }))
      .status,
    409,
  );
  const create = { ...req(), locationIds: [b.id] };
  await ok("stocktakes", create);
  await assert.rejects(
    w.updateWarehousePlan({ ...create, width: 100, depth: 100 }),
    /requestId/,
  );
  s = await w.createMovement({
    ...req(),
    palletId: p.id,
    toLocationId: b.id,
    employeeId: manager.user.employeeId,
    kind: "transfer",
  });
  const move = s.movements.at(-1)!;
  await w.takeMovement(move.id, {
    ...req(),
    palletCode: p.code,
    locationCode: a.code,
  });
  await w.placeMovement(move.id, {
    ...req(),
    palletCode: p.code,
    locationCode: b.code,
  });
  s = await w.createMovement({
    ...req(),
    palletId: p.id,
    toLocationId: a.id,
    employeeId: manager.user.employeeId,
    kind: "transfer",
  });
  const back = s.movements.at(-1)!;
  await w.takeMovement(back.id, {
    ...req(),
    palletCode: p.code,
    locationCode: b.code,
  });
  await w.placeMovement(back.id, {
    ...req(),
    palletCode: p.code,
    locationCode: a.code,
  });
  const stale = await get(d.id);
  assert(stale.rows.every((r) => r.stale));
});
test("approval rejects busy whole scope and rolls back all quantities; concurrent tabs and command keys", async () => {
  const a = await location("ST-BUSY-A", 48),
    b = await location("ST-BUSY-B", 51),
    p = await rawAt(a);
  let d = await doc([a.id, b.id]);
  d = await count(d, a.id, [{ palletCode: p.code, quantity: 90 }]);
  d = await count(d, b.id);
  d = await submit(d);
  const prior = await w.snapshot();
  await w.createMovement({
    ...req(),
    palletId: p.id,
    toLocationId: b.id,
    employeeId: manager.user.employeeId,
    kind: "transfer",
  });
  const r = await call("POST", `stocktakes/${d.id}/approve`, {
    ...req(),
    expectedRevision: d.revision,
    reason: "Попытка утверждения занятого адреса",
  });
  assert.equal(r.status, 409);
  assert.equal(
    (await w.snapshot()).pallets.find((x) => x.id === p.id)!.quantity,
    100,
  );
  assert.equal((await get(d.id)).status, "review");
  const l = await location("ST-RACE", 54),
    queued = await ok("stocktakes", { ...req(), locationIds: [l.id] });
  const results = await Promise.all(
    [worker, other].map((a) =>
      call(
        "POST",
        `stocktakes/${queued.id}/claim`,
        { ...req(), expectedRevision: queued.revision },
        a,
      ),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 403]);
});
test("planner respects box profile capacity, QR aliases, paired known relocation/writeoff and incompatible/unknown issues", async () => {
  const s = await w.snapshot(),
    source = s.pallets.find(
      (p) =>
        p.kind === "finished" &&
        p.quantity > 1 &&
        s.locations.find((l) => l.id === p.locationId)?.kind === "rack",
    )!;
  assert(source);
  const target = s.locations.find(
      (l) => l.kind === "rack" && !s.pallets.some((p) => p.locationId === l.id),
    )!,
    boxes = s.boxes.filter(
      (b) => b.palletId === source.id && b.status === "stored",
    ),
    a = stocktakeRow(s, source.locationId!, 0),
    b = stocktakeRow(s, target.id, 0),
    versions = new Map([
      [a.locationId, 0],
      [b.locationId, 0],
    ]);
  a.count = { rawPallets: [], boxCodes: [] };
  a.countVersion = 0;
  b.count = {
    rawPallets: [],
    boxCodes: boxes.map((x) => `artmate-wms:box:${x.code}`),
  };
  b.countVersion = 0;
  const p = stocktakePlan(s, [a, b], versions, 1);
  assert.equal(p.preview.canApprove, true, JSON.stringify(p.preview));
  assert.equal(p.state!.pallets.find((x) => x.id === source.id)!.quantity, 0);
  assert.equal(
    p.state!.pallets.find((x) => x.id === source.id)!.locationId,
    source.locationId,
  );
  assert.deepEqual(
    p
      .state!.boxes.filter((x) => boxes.some((b) => b.id === x.id))
      .map((x) => x.lotContents),
    boxes.map((x) => x.lotContents),
  );
  b.count.boxCodes = [boxes[0].code, `artmate-wms:box:${boxes[0].code}`];
  assert(
    stocktakePlan(s, [a, b], versions, 1).preview.issues.some(
      (i) => i.code === "DUPLICATE_BOX",
    ),
  );
  b.count.boxCodes = [`artmate-wms:pallet:${boxes[0].code}`];
  assert(
    stocktakePlan(s, [a, b], versions, 1).preview.issues.some(
      (i) => i.code === "UNKNOWN_BOX",
    ),
  );
  b.count.boxCodes = boxes.map((x) => x.code);
  for (const box of boxes) {
    box.packagingSnapshot.boxesPerLayer = 1;
    box.packagingSnapshot.maxLayers = 1;
  }
  assert(
    stocktakePlan(s, [a, b], versions, 1).preview.issues.some(
      (i) => i.code === "PHYSICAL_CONFLICT",
    ),
  );
});

test("finished HTTP relocation and writeoff preserve provenance and empty source; SQL failure rolls warehouse/document/ledger/epochs/cache back", async () => {
  const before = await w.snapshot(),
    p = before.pallets.find(
      (p) =>
        p.kind === "finished" &&
        p.quantity > 1 &&
        before.locations.find((l) => l.id === p.locationId)?.kind === "rack",
    )!,
    target = await location("ST-BOX-TARGET", 57),
    boxes = before.boxes.filter(
      (b) => b.palletId === p.id && b.status === "stored",
    ),
    provenance = boxes.map((b) => ({
      id: b.id,
      lotContents: b.lotContents,
      packedAt: b.packedAt,
      packagingSnapshot: b.packagingSnapshot,
    }));
  let d = await doc([p.locationId!, target.id]);
  d = await count(d, p.locationId!, [], []);
  d = await count(
    d,
    target.id,
    [],
    boxes.map((b) => b.code),
  );
  d = await submit(d);
  const body = {
      ...req(),
      expectedRevision: d.revision,
      reason: "Исправление фактического адреса коробов",
    },
    stateBefore = await w.snapshot(),
    epochsBefore = (
      await sql().query(
        "SELECT * FROM stocktake_cell_versions ORDER BY location_id",
      )
    ).rows,
    ledgerBefore = (await sql().query("SELECT * FROM stock_ledger ORDER BY id"))
      .rows,
    eventsBefore = (await sql().query("SELECT * FROM work_events ORDER BY id"))
      .rows;
  await sql().query(
    "CREATE FUNCTION fail_stocktake_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload->>'referenceType'='stocktake' THEN RAISE EXCEPTION 'forced stocktake rollback'; END IF; RETURN NEW; END; $$",
  );
  await sql().query(
    "CREATE TRIGGER fail_stocktake_ledger BEFORE INSERT ON stock_ledger FOR EACH ROW EXECUTE FUNCTION fail_stocktake_ledger()",
  );
  assert.equal(
    (await call("POST", `stocktakes/${d.id}/approve`, body)).status,
    500,
  );
  assert.deepEqual(await w.snapshot(), stateBefore);
  assert.equal((await get(d.id)).revision, d.revision);
  assert.equal((await get(d.id)).status, "review");
  assert.deepEqual(
    (
      await sql().query(
        "SELECT * FROM stocktake_cell_versions ORDER BY location_id",
      )
    ).rows,
    epochsBefore,
  );
  assert.deepEqual(
    (await sql().query("SELECT * FROM stock_ledger ORDER BY id")).rows,
    ledgerBefore,
  );
  assert.equal(
    (
      await sql().query(
        "SELECT * FROM stocktake_commands WHERE request_id=$1",
        [body.requestId],
      )
    ).rows.length,
    0,
  );
  await sql().query("DROP TRIGGER fail_stocktake_ledger ON stock_ledger");
  await sql().query("DROP FUNCTION fail_stocktake_ledger()");
  const approved = await ok(`stocktakes/${d.id}/approve`, body),
    after = await w.snapshot();
  assert.equal(after.pallets.find((x) => x.id === p.id)!.quantity, 0);
  assert.equal(
    after.pallets.find((x) => x.id === p.id)!.locationId,
    p.locationId,
  );
  for (const original of provenance) {
    const box = after.boxes.find((x) => x.id === original.id)!;
    assert.equal(box.locationId, target.id);
    assert.deepEqual(
      {
        id: box.id,
        lotContents: box.lotContents,
        packedAt: box.packedAt,
        packagingSnapshot: box.packagingSnapshot,
      },
      original,
    );
  }
  assert.deepEqual(
    (await sql().query("SELECT * FROM work_events ORDER BY id")).rows,
    eventsBefore,
  );
  assert.equal(approved.preview.unitsDelta, 0);
  let writeoff = await doc([target.id]);
  writeoff = await count(
    writeoff,
    target.id,
    [],
    boxes.slice(1).map((b) => b.code),
  );
  writeoff = await submit(writeoff);
  await approve(writeoff);
  const written = (await w.snapshot()).boxes.find((b) => b.id === boxes[0].id)!;
  assert.equal(written.status, "written_off");
  assert.deepEqual(written.lotContents, boxes[0].lotContents);
  assert.equal(
    written.palletId,
    after.boxes.find((b) => b.id === written.id)!.palletId,
  );
  await assert.rejects(
    sql().query("DELETE FROM stocktake_history WHERE document_id=$1", [d.id]),
    /immutable/,
  );
  assert.equal((await get(d.id)).status, "approved");
});
test("actual HTTP rejects invalid count bodies, another cell route replay and cached count after shift off", async () => {
  const l = await location("ST-STRICT", 60),
    second = await location("ST-STRICT-2", 63);
  let d = await doc([l.id, second.id], worker);
  const body = {
    ...req(),
    expectedRevision: d.revision,
    locationCode: l.code,
    rawPallets: [],
    boxCodes: [],
  };
  for (const patch of [
    { rawPallets: null },
    { boxCodes: null },
    { boxCodes: [null] },
    { rawPallets: [{ palletCode: "X", quantity: -1 }] },
    { rawPallets: [{ palletCode: "X", quantity: "2" }] },
    { locationCode: null },
    { expectedRevision: null },
    { extra: 1 },
  ])
    assert.equal(
      (
        await call(
          "POST",
          `stocktakes/${d.id}/rows/${l.id}/count`,
          { ...body, ...patch },
          worker,
        )
      ).status,
      400,
    );
  d = await ok(`stocktakes/${d.id}/rows/${l.id}/count`, body, worker);
  assert.equal(
    (
      await call(
        "POST",
        `stocktakes/${d.id}/rows/${second.id}/count`,
        body,
        worker,
      )
    ).status,
    409,
  );
  await call(
    "POST",
    `employees/${worker.user.employeeId}/shift`,
    { ...req(), status: "off" },
    worker,
  );
  assert.equal(
    (await call("POST", `stocktakes/${d.id}/rows/${l.id}/count`, body, worker))
      .status,
    403,
  );
  await call(
    "POST",
    `employees/${worker.user.employeeId}/shift`,
    { ...req(), status: "working" },
    worker,
  );
  const account = (await call("GET", "auth/accounts")).body.items.find(
    (a: D.AuthAccountDto) => a.employeeId === worker.user.employeeId,
  );
  await call("POST", `auth/accounts/${account.id}/revoke-sessions`, {});
  assert.equal(
    (await call("GET", `stocktakes/${d.id}`, undefined, worker)).status,
    401,
  );
});
