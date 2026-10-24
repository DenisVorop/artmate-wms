import "reflect-metadata";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";
import { ValidationPipe } from "@nestjs/common";
import { WarehouseService } from "../src/warehouse.service";
import { WarehouseController } from "../src/app";
import * as D from "../src/dto";
import { Queryable } from "../src/database";
const req = () => ({ requestId: randomUUID() });
let w: WarehouseService, initial: D.WorkspaceDto;
let actor: string, raw: D.PalletDto, receipt: D.ReceiptDto, box: D.BoxDto;
const sql = () => (w as unknown as { db: Queryable }).db;
const checked = <T>(type: new () => T, value: unknown) =>
  new ValidationPipe({
    expectedType: type,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }).transform(value, { type: "body" });
before(async () => {
  const url = process.env.WMS_LEDGER_TEST_DATABASE_URL;
  if (url) {
    const database = new Client({ connectionString: url }).database ?? "";
    if (database === "artmate_wms" || !database.endsWith("_test"))
      throw new Error("Ledger tests require an isolated _test database");
    process.env.DATABASE_URL = url;
    delete process.env.WMS_DATA_DIR;
  } else process.env.WMS_DATA_DIR = "memory://";
  w = new WarehouseService();
  initial = await w.snapshot();
  actor = initial.employees.find((e) => e.status === "working")!.id;
});
after(async () => w?.onModuleDestroy());
const adjustment = (p: D.PalletDto, count: number, extra = {}) =>
  w.adjustStock({
    ...req(),
    kind: "raw_count",
    targetId: p.id,
    employeeId: actor,
    expectedLocationId: p.locationId!,
    expectedQuantity: p.quantity,
    countedQuantity: count,
    reason: "Фактический пересчёт",
    ...extra,
  });
async function reconciled() {
  const l = await w.getStockLedger({});
  assert.equal(l.summary.reconciled, true);
  assert.equal(l.summary.ledgerUnits, l.summary.onHandUnits);
  return l;
}
test("opening balance captures admitted positions, original lot metadata and global reconciliation", async () => {
  const page = await reconciled(),
    opening = page.items.find((e) => e.kind === "opening_balance")!;
  assert.equal(opening.unitsDelta, initial.balance.totalUnits);
  assert.equal(opening.revision, initial.revision);
  assert.equal(opening.employeeId, null);
  assert.equal(opening.requestId, null);
  assert.equal(
    opening.lines.reduce((n, l) => n + l.quantityDelta, 0),
    opening.unitsDelta,
  );
  for (const l of opening.lines)
    assert.equal(
      initial.lots.find((x) => x.id === l.lotId)!.receivedAt,
      l.receivedAt,
    );
});
test("real controller ValidationPipe rejects null missing unknown and coerced quantities; query page limits transform", async () => {
  const controller = new WarehouseController(w);
  const base = {
    ...req(),
    kind: "raw_count",
    targetId: "p",
    employeeId: actor,
    expectedLocationId: "a",
    expectedQuantity: 1,
    countedQuantity: 0,
    reason: " Причина пересчёта ",
  };
  for (const body of [
    { ...base, reason: "    " },
    { ...base, countedQuantity: null },
    { ...base, countedQuantity: "2" },
    { ...base, expectedLocationId: null },
    { ...base, kind: "bogus" },
    { ...base, extra: true },
    Object.fromEntries(
      Object.entries(base).filter(([k]) => k !== "employeeId"),
    ),
  ])
    await assert.rejects(checked(D.AdjustStockDto, body));
  const dto = await checked(D.AdjustStockDto, base);
  assert.equal(dto.reason, "Причина пересчёта");
  await assert.rejects(controller.adjustStock(dto));
  for (const body of [
    { page: null },
    { page: "NaN" },
    { pageSize: "101" },
    { kind: null },
    { from: "tomorrow" },
    { from: "2026-02-31T12:00:00Z" },
    { extra: "no" },
  ])
    await assert.rejects(checked(D.StockLedgerQueryDto, body));
  assert.equal(
    (
      await controller.getStockLedger(
        await checked(D.StockLedgerQueryDto, { page: "1", pageSize: "1" }),
      )
    ).pageSize,
    1,
  );
  await assert.rejects(
    w.getStockLedger({
      from: "2026-10-25T00:00:00Z",
      to: "2026-10-24T00:00:00Z",
    }),
  );
});
test("pending receipt has no ledger admission; placement admits once at actual receipt date; count above receipt quantity preserves original history", async () => {
  const before = await reconciled();
  let s = await w.createReceipt({
    ...req(),
    receivedAt: "2021-03-04T09:15:00.000Z",
    pallets: [
      {
        newSku: {
          name: "Ledger special",
          barcode: `LEDGER-${randomUUID()}`,
          unitsPerBox: 2,
        },
        quantity: 10,
        widthMm: 1200,
        depthMm: 800,
        heightMm: 800,
      },
    ],
  });
  receipt = s.receipts.find(
    (r) => !initial.receipts.some((old) => old.id === r.id),
  )!;
  raw = s.pallets.find((p) => p.id === receipt.pallets[0].palletId)!;
  assert.equal(
    (await reconciled()).summary.eventsCount,
    before.summary.eventsCount,
  );
  const options = await w.getReceiptPlacementOptions(receipt.id, raw.id),
    loc = s.locations.find((l) => l.id === options.suggestedLocationId)!;
  const place = {
    ...req(),
    employeeId: actor,
    palletCode: raw.code,
    locationCode: loc.code,
  };
  s = await w.placeReceiptPallet(receipt.id, raw.id, place);
  raw = s.pallets.find((p) => p.id === raw.id)!;
  const after = await reconciled(),
    event = after.items.find((e) => e.requestId === place.requestId)!;
  assert.equal(event.kind, "receipt_placement");
  assert.equal(event.unitsDelta, 10);
  assert.equal(event.lines[0].receivedAt, "2021-03-04T09:15:00.000Z");
  await w.placeReceiptPallet(receipt.id, raw.id, place);
  assert.equal((await w.snapshot()).revision, s.revision);
  assert.equal(
    (await reconciled()).summary.eventsCount,
    after.summary.eventsCount,
  );
  s = await adjustment(raw, 14);
  raw = s.pallets.find((p) => p.id === raw.id)!;
  assert.equal(raw.quantity, 14);
  assert.equal(
    s.receipts.find((r) => r.id === receipt.id)!.pallets[0].quantity,
    10,
  );
  const correction = (await reconciled()).items.find(
    (e) => e.kind === "adjustment",
  )!;
  assert.equal(correction.unitsDelta, 4);
  assert.equal(correction.employeeId, actor);
  assert.equal(correction.lines[0].lotId, raw.lotId);
});
test("stale address/count, inactive actor, no-op and primary reservation guards preserve snapshot and journal", async () => {
  const original = await w.snapshot(),
    count = (await reconciled()).summary.eventsCount;
  for (const extra of [
    { expectedQuantity: 999 },
    { expectedLocationId: "old" },
    { employeeId: original.employees.find((e) => e.status !== "working")!.id },
  ])
    await assert.rejects(adjustment(raw, 2, extra));
  await assert.rejects(adjustment(raw, raw.quantity));
  assert.deepEqual(await w.snapshot(), original);
  assert.equal((await reconciled()).summary.eventsCount, count);
  await w.createTask({ ...req(), skuId: raw.skuId!, boxesTarget: 1 });
  await assert.rejects(adjustment(raw, 2), /зарезервирован/);
});
test("assembly raw→WIP→boxed and putaway carrying record per-lot zero net deltas with null transit location", async () => {
  let s = await w.snapshot();
  const task = s.tasks.find(
      (t) => t.skuId === raw.skuId && t.status === "queued",
    )!,
    sku = s.skus.find((x) => x.id === raw.skuId)!;
  const name = `Ledger assembler ${randomUUID()}`;
  s = await w.createEmployee({ ...req(), name });
  actor = s.employees.find((e) => e.name === name)!.id;
  await w.updateShift(actor, { ...req(), status: "working" });
  await w.claimTask(task.id, { ...req(), employeeId: actor });
  await w.scanTask(task.id, {
    ...req(),
    employeeId: actor,
    kind: "source",
    value: raw.code,
  });
  await w.scanTask(task.id, {
    ...req(),
    employeeId: actor,
    kind: "box",
    value: task.openBoxCode,
  });
  const first = {
    ...req(),
    employeeId: actor,
    kind: "barcode" as const,
    value: sku.barcode,
  };
  s = await w.scanTask(task.id, first);
  let e = (await reconciled()).items.find(
    (e) => e.requestId === first.requestId,
  )!;
  assert.equal(e.unitsDelta, 0);
  assert.deepEqual(e.lines.map((l) => l.stage).sort(), ["raw", "wip"]);
  const last = {
    ...req(),
    employeeId: actor,
    kind: "barcode" as const,
    value: sku.barcode,
  };
  s = await w.scanTask(task.id, last);
  box = s.boxes.find((b) => b.code === task.openBoxCode)!;
  e = (await reconciled()).items.find((e) => e.requestId === last.requestId)!;
  assert.equal(e.unitsDelta, 0);
  assert.equal(
    e.lines.some((l) => l.stage === "boxed" && l.quantityDelta === 2),
    true,
  );
  await assert.rejects(
    w.adjustStock({
      ...req(),
      kind: "box_writeoff",
      targetId: box.id,
      employeeId: actor,
      expectedLocationId: box.locationId!,
      expectedQuantity: 1,
      countedQuantity: 0,
      reason: "Нельзя списать сборку",
    }),
  );
  const put = s.putawayTasks.find((t) => t.boxId === box.id)!;
  s = await w.claimPutawayTask(put.id, { ...req(), employeeId: actor });
  const current = s.putawayTasks.find((t) => t.id === put.id)!,
    from = s.locations.find((l) => l.id === current.fromLocationId)!,
    target = s.locations.find((l) => l.id === current.toLocationId)!;
  const take = {
    ...req(),
    employeeId: actor,
    boxCode: box.code,
    locationCode: from.code,
  };
  s = await w.takePutawayTask(put.id, take);
  const carried = s.boxes.find((b) => b.id === box.id)!;
  assert.equal(carried.palletId, null);
  assert.equal(carried.locationId, null);
  e = (await reconciled()).items.find((e) => e.requestId === take.requestId)!;
  assert.equal(e.kind, "putaway");
  assert.equal(e.unitsDelta, 0);
  assert.equal(
    e.lines.some((l) => l.locationId === null && l.quantityDelta === 2),
    true,
  );
  s = await w.placePutawayTask(put.id, {
    ...req(),
    employeeId: actor,
    boxCode: box.code,
    locationCode: target.code,
  });
  box = s.boxes.find((b) => b.id === box.id)!;
  raw = s.pallets.find((p) => p.id === raw.id)!;
  await reconciled();
});
test("box writeoff preserves provenance, recalculates pallet and replay is once; raw zero retains physical occupancy", async () => {
  const before = await w.snapshot(),
    originalBox = structuredClone(box),
    p = before.pallets.find((p) => p.id === box.palletId)!;
  const command = {
    ...req(),
    kind: "box_writeoff",
    targetId: box.id,
    employeeId: actor,
    expectedLocationId: box.locationId!,
    expectedQuantity: 1,
    countedQuantity: 0,
    reason: "Повреждение при проверке",
  };
  let s = await w.adjustStock(command);
  const written = s.boxes.find((b) => b.id === box.id)!;
  assert.equal(written.status, "written_off");
  assert.deepEqual(written.lotContents, originalBox.lotContents);
  assert.deepEqual(written.packagingSnapshot, originalBox.packagingSnapshot);
  assert.equal(s.pallets.find((x) => x.id === p.id)!.quantity, p.quantity - 1);
  assert.equal(s.balance.totalUnits, before.balance.totalUnits - box.units);
  const count = (await reconciled()).summary.eventsCount;
  await w.adjustStock(command);
  assert.equal((await reconciled()).summary.eventsCount, count);
  assert.equal((await w.snapshot()).revision, s.revision);
  await assert.rejects(
    w.createShipment({ ...req(), skuId: box.skuId, boxesRequested: 1 }),
  );
  s = await adjustment(raw, 0);
  raw = s.pallets.find((p) => p.id === raw.id)!;
  assert.equal(raw.quantity, 0);
  assert.notEqual(raw.locationId, null);
  assert.equal(raw.status, "stored");
  await assert.rejects(w.deleteLocation(raw.locationId!, req()));
  await reconciled();
});
test("immutable triggers reject update/delete; journal insert failure rolls back stock revision and idempotency key", async () => {
  await assert.rejects(
    sql().query("UPDATE stock_ledger SET revision=revision+1"),
    /immutable/,
  );
  await assert.rejects(sql().query("DELETE FROM stock_ledger"), /immutable/);
  const before = await w.snapshot(),
    ledger = await reconciled();
  const command = {
    ...req(),
    kind: "raw_count",
    targetId: raw.id,
    employeeId: actor,
    expectedLocationId: raw.locationId!,
    expectedQuantity: 0,
    countedQuantity: 3,
    reason: "Повторный пересчёт",
  };
  await sql().query(
    "CREATE FUNCTION ledger_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test ledger insert failure'; END; $$",
  );
  await sql().query(
    "CREATE TRIGGER ledger_test_failure BEFORE INSERT ON stock_ledger FOR EACH ROW EXECUTE FUNCTION ledger_test_failure()",
  );
  try {
    await assert.rejects(w.adjustStock(command), /test ledger insert failure/);
    assert.deepEqual(await w.snapshot(), before);
    assert.equal(
      (await reconciled()).summary.eventsCount,
      ledger.summary.eventsCount,
    );
  } finally {
    await sql().query("DROP TRIGGER ledger_test_failure ON stock_ledger");
    await sql().query("DROP FUNCTION ledger_test_failure()");
  }
  const s = await w.adjustStock(command);
  assert.equal(s.pallets.find((p) => p.id === raw.id)!.quantity, 3);
  await reconciled();
});
test("filters include both time boundaries and escape search; geometry rename does not generate stock entries; compensated tampering fails position reconciliation", async () => {
  const all = await reconciled(),
    event = all.items.find((e) => e.kind === "adjustment")!;
  assert.equal(
    (
      await w.getStockLedger({ from: event.createdAt, to: event.createdAt })
    ).items.some((e) => e.id === event.id),
    true,
  );
  const filtered = await w.getStockLedger({
    kind: "adjustment",
    skuId: raw.skuId!,
    employeeId: actor,
    pageSize: 1,
  });
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.summary.eventsCount, all.summary.eventsCount);
  assert.equal((await w.getStockLedger({ search: "%' OR 1=1 --" })).total, 0);
  assert.equal((await w.getStockLedger({ search: raw.code })).total > 0, true);
  const s = await w.snapshot(),
    loc = s.locations.find((l) => l.id === raw.locationId)!;
  await w.updateLocation(loc.id, {
    ...req(),
    name: `${loc.name} переименован`,
  });
  assert.equal(
    (await reconciled()).summary.eventsCount,
    all.summary.eventsCount,
  );
  const candidates = s.pallets.filter(
      (p) => p.kind === "raw" && p.status === "stored" && p.quantity > 1,
    ),
    a = candidates[0],
    b = candidates.find((p) => p.skuId !== a.skuId)!;
  await sql().query(
    "UPDATE pallets SET payload=jsonb_set(payload,'{quantity}',to_jsonb((payload->>'quantity')::int+1)) WHERE id=$1",
    [a.id],
  );
  await sql().query(
    "UPDATE pallets SET payload=jsonb_set(payload,'{quantity}',to_jsonb((payload->>'quantity')::int-1)) WHERE id=$1",
    [b.id],
  );
  const mismatch = await w.getStockLedger({});
  assert.equal(mismatch.summary.ledgerUnits, mismatch.summary.onHandUnits);
  assert.equal(mismatch.summary.reconciled, false);
  await sql().query("UPDATE pallets SET payload=$2 WHERE id=$1", [
    a.id,
    JSON.stringify(a),
  ]);
  await sql().query("UPDATE pallets SET payload=$2 WHERE id=$1", [
    b.id,
    JSON.stringify(b),
  ]);
  await reconciled();
});
test("concurrent same-key and stale independent counts append once, whole-pallet transit is conserved and blocks correction", async () => {
  let s = await w.snapshot();
  raw = s.pallets.find((p) => p.id === raw.id)!;
  const body = {
    ...req(),
    kind: "raw_count",
    targetId: raw.id,
    employeeId: actor,
    expectedLocationId: raw.locationId!,
    expectedQuantity: raw.quantity,
    countedQuantity: raw.quantity + 2,
    reason: "Проверка конкуренции",
  };
  const before = (await reconciled()).summary.eventsCount;
  const second = process.env.WMS_LEDGER_TEST_DATABASE_URL
    ? new WarehouseService()
    : w;
  try {
    const results = await Promise.all([
      w.adjustStock(body),
      second.adjustStock(body),
    ]);
    assert.deepEqual(results[0], results[1]);
    assert.equal((await reconciled()).summary.eventsCount, before + 1);
    const newer = {
      ...body,
      ...req(),
      expectedQuantity: body.countedQuantity,
      countedQuantity: body.countedQuantity + 1,
    };
    const stale = await Promise.allSettled([
      w.adjustStock(newer),
      second.adjustStock({
        ...newer,
        ...req(),
        countedQuantity: newer.countedQuantity + 1,
      }),
    ]);
    assert.equal(stale.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal((await reconciled()).summary.eventsCount, before + 2);
  } finally {
    if (second !== w) await second.onModuleDestroy();
  }
  s = await w.snapshot();
  raw = s.pallets.find((p) => p.id === raw.id)!;
  const target = s.locations.find(
    (l) =>
      !l.archived &&
      !l.blocked &&
      l.kind === "rack" &&
      l.maxHeightMm >= raw.heightMm &&
      !s.pallets.some((p) => p.locationId === l.id) &&
      !s.movements.some(
        (m) =>
          ["planned", "in_transit"].includes(m.status) &&
          m.toLocationId === l.id,
      ),
  )!;
  s = await w.createMovement({
    ...req(),
    palletId: raw.id,
    toLocationId: target.id,
    employeeId: actor,
    kind: "transfer",
  });
  const m = s.movements.find(
    (m) => m.palletId === raw.id && m.status === "planned",
  )!;
  const saved = await w.snapshot();
  await assert.rejects(adjustment(raw, 1), /перемещении/);
  assert.deepEqual(await w.snapshot(), saved);
  const from = s.locations.find((l) => l.id === raw.locationId)!;
  const take = { ...req(), palletCode: raw.code, locationCode: from.code };
  await w.takeMovement(m.id, take);
  const event = (await reconciled()).items.find(
    (e) => e.requestId === take.requestId,
  )!;
  assert.equal(event.kind, "movement");
  assert.equal(event.employeeId, null);
  assert.equal(event.unitsDelta, 0);
  assert.equal(event.lines.length, 2);
  await w.placeMovement(m.id, {
    ...req(),
    palletCode: raw.code,
    locationCode: target.code,
  });
  await reconciled();
});

test("schema8 stocked migration creates one baseline, preserves IDs quantities revisions and cached responses across restart; empty baseline is explicit", async () => {
  const previous = process.env.WMS_DATA_DIR,
    dir = await mkdtemp(join(tmpdir(), "wms-ledger-migration-"));
  const path = join(dir, "db");
  let migrated: WarehouseService | undefined;
  try {
    const legacy = structuredClone(initial);
    const raw = legacy.pallets.find((p) => p.kind === "raw" && p.quantity > 3)!;
    const task = structuredClone((await w.snapshot()).tasks[0]);
    legacy.tasks = [task];
    task.skuId = raw.skuId!;
    task.status = "paused";
    task.unitsPerBox = 20;
    task.boxesTarget = 1;
    task.boxesCompleted = 0;
    task.openBoxContents = [{ lotId: raw.lotId!, quantity: 3 }];
    task.scannedUnits = 3;
    raw.quantity -= 3;
    const transit = legacy.boxes[0];
    transit.status = "in_transit";
    transit.locationId = null;
    const oldPal = legacy.pallets.find((p) => p.id === transit.palletId)!;
    oldPal.quantity--;
    transit.palletId = null;
    legacy.pallets.push({
      ...raw,
      id: "legacy-pending",
      code: "LEGACY-PENDING",
      status: "awaiting_placement",
      quantity: 25,
      locationId: null,
    });
    const shipped = legacy.boxes[1];
    shipped.status = "shipped";
    legacy.pallets.find((p) => p.id === shipped.palletId)!.quantity--;
    const command = { requestId: "legacy-cached-ledger", width: 30, depth: 30 };
    const response = { revision: 11, legacy: true };
    const db = new PGlite(path);
    await db.waitReady;
    for (const [table, rows] of Object.entries(legacy))
      if (Array.isArray(rows)) {
        await db.exec(
          `CREATE TABLE ${table}(id TEXT PRIMARY KEY,payload JSONB NOT NULL)`,
        );
        for (const entity of rows)
          await db.query(`INSERT INTO ${table} VALUES($1,$2)`, [
            entity.id,
            JSON.stringify(entity),
          ]);
      }
    await db.exec(
      "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE commands(request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,response JSONB NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW())",
    );
    for (const [key, value] of [
      ["seeded", "1"],
      ["schema_version", "7"],
      ["workspace_revision", "48"],
      ["warehouse", JSON.stringify(legacy.warehouse)],
    ])
      await db.query("INSERT INTO metadata VALUES($1,$2)", [key, value]);
    await db.query(
      "INSERT INTO commands(request_id,fingerprint,response) VALUES($1,$2,$3)",
      [
        command.requestId,
        createHash("sha256")
          .update(JSON.stringify(["updateWarehousePlan", command]))
          .digest("hex"),
        JSON.stringify(response),
      ],
    );
    await db.close();
    process.env.WMS_DATA_DIR = path;
    migrated = new WarehouseService();
    let state = await migrated.snapshot();
    assert.equal(state.revision, 48);
    assert.deepEqual(
      state.pallets.map((p) => p.id).sort(),
      legacy.pallets.map((p) => p.id).sort(),
    );
    assert.deepEqual(
      state.boxes,
      legacy.boxes.sort((a, b) => a.id.localeCompare(b.id)),
    );
    assert.deepEqual(
      state.tasks,
      legacy.tasks.sort((a, b) => a.id.localeCompare(b.id)),
    );
    assert.deepEqual(await migrated.updateWarehousePlan(command), response);
    const ledger = await migrated.getStockLedger({});
    assert.equal(ledger.total, 1);
    assert.equal(ledger.items[0].revision, 48);
    assert.equal(ledger.summary.reconciled, true);
    assert.equal(
      ledger.items[0].lines.some((l) => l.containerId === "legacy-pending"),
      false,
    );
    assert.equal(
      ledger.items[0].lines.some((l) => l.containerId === shipped.id),
      false,
    );
    assert.equal(
      ledger.items[0].lines.some(
        (l) => l.containerId === transit.id && l.locationId === null,
      ),
      true,
    );
    assert.equal(
      ledger.items[0].lines.some((l) => l.stage === "wip"),
      true,
    );
    await migrated.onModuleDestroy();
    migrated = new WarehouseService();
    assert.deepEqual(await migrated.snapshot(), state);
    assert.deepEqual(await migrated.getStockLedger({}), ledger);
    await migrated.onModuleDestroy();
    migrated = undefined;
    const empty = join(dir, "empty"),
      edb = new PGlite(empty);
    await edb.waitReady;
    await edb.exec(
      "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);INSERT INTO metadata VALUES('seeded','1'),('schema_version','7'),('workspace_revision','12')",
    );
    await edb.close();
    process.env.WMS_DATA_DIR = empty;
    migrated = new WarehouseService();
    const opening = await migrated.getStockLedger({});
    assert.equal(opening.total, 1);
    assert.equal(opening.items[0].unitsDelta, 0);
    assert.deepEqual(opening.items[0].lines, []);
    assert.equal(opening.items[0].revision, 12);
    assert.equal(opening.summary.reconciled, true);
  } finally {
    await migrated?.onModuleDestroy();
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("shipment reservations and inactive addresses reject adjustments without journal events or partial state", async () => {
  let s = await w.snapshot();
  const ready = s.boxes.find(
    (b) =>
      b.status === "stored" &&
      s.pallets.some(
        (p) =>
          p.id === b.palletId && p.kind === "finished" && p.status === "stored",
      ) &&
      !s.putawayTasks.some((t) => t.boxId === b.id && t.status !== "completed"),
  )!;
  s = await w.createShipment({
    ...req(),
    skuId: ready.skuId,
    boxesRequested: 1,
  });
  const draft = s.shipments.find(
      (x) => x.skuId === ready.skuId && x.status === "draft",
    )!,
    reserved = s.boxes.find((b) => b.id === draft.boxIds[0])!;
  const before = await w.snapshot(),
    count = (await reconciled()).summary.eventsCount;
  await assert.rejects(
    w.adjustStock({
      ...req(),
      kind: "box_writeoff",
      targetId: reserved.id,
      employeeId: actor,
      expectedLocationId: reserved.locationId!,
      expectedQuantity: 1,
      countedQuantity: 0,
      reason: "Попытка списать резерв",
    }),
    /зарезервирован/,
  );
  assert.deepEqual(await w.snapshot(), before);
  assert.equal((await reconciled()).summary.eventsCount, count);
  raw = s.pallets.find((p) => p.id === raw.id)!;
  const loc = s.locations.find((l) => l.id === raw.locationId)!;
  for (const changes of [
    { blocked: true },
    { archived: true, archivedAt: new Date().toISOString() },
  ]) {
    await sql().query("UPDATE locations SET payload=$2 WHERE id=$1", [
      loc.id,
      JSON.stringify({ ...loc, ...changes }),
    ]);
    const invalid = await w.snapshot();
    await assert.rejects(adjustment(raw, raw.quantity + 1));
    assert.deepEqual(await w.snapshot(), invalid);
    assert.equal((await w.getStockLedger({})).summary.eventsCount, count);
    await sql().query("UPDATE locations SET payload=$2 WHERE id=$1", [
      loc.id,
      JSON.stringify(loc),
    ]);
  }
  await reconciled();
});
