import "reflect-metadata";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WarehouseService } from "../src/warehouse.service";
import { placementError } from "../src/physical";
import type * as D from "../src/dto";

const req = () => ({ requestId: randomUUID() });
const employeeId = "employee-1";
let w: WarehouseService;
let position: number;
beforeEach(async () => {
  // This suite cannot connect to the live warehouse, even when DATABASE_URL exists.
  process.env.WMS_DATA_DIR = "memory://";
  w = new WarehouseService();
  await w.updateWarehousePlan({ ...req(), width: 100, depth: 100 });
  position = 0;
});
afterEach(async () => w?.onModuleDestroy());

async function location(kind = "floor") {
  const code = `RELEASE-${position}`;
  const s = await w.createLocation({
    ...req(),
    code,
    name: code,
    kind,
    x: 30 + position++ * 4,
    y: 40,
    width: 2,
    depth: 2,
    levels: 1,
    maxHeightMm: 2500,
    maxBoxes: 36,
    availableWidthMm: 1400,
    availableDepthMm: 1000,
    accessSides: 4,
  });
  return s.locations.find((l) => l.code === code)!;
}
async function receive(
  quantity: number,
  unitsPerBox = 20,
  skuId?: string,
  receivedAt = "2026-10-01T10:00:00Z",
  target?: D.LocationDto,
) {
  const barcode = `RELEASE-${randomUUID()}`;
  const before = await w.snapshot();
  const s = await w.createReceipt({
    ...req(),
    receivedAt,
    pallets: [
      {
        ...(skuId
          ? { skuId }
          : { newSku: { name: barcode, barcode, unitsPerBox } }),
        quantity,
        widthMm: 1200,
        depthMm: 800,
        heightMm: 700,
      },
    ],
  });
  const receipt = s.receipts.find(
    (r) => !before.receipts.some((old) => old.id === r.id),
  )!;
  const pallet = s.pallets.find((p) => p.id === receipt.pallets[0].palletId)!;
  const address = target ?? (await location());
  await w.placeReceiptPallet(receipt.id, pallet.id, {
    ...req(),
    employeeId,
    palletCode: pallet.code,
    locationCode: address.code,
  });
  return {
    pallet,
    address,
    receiptId: receipt.id,
    sku: (await w.snapshot()).skus.find((x) => x.id === pallet.skuId)!,
  };
}
async function task(skuId: string, boxesTarget = 1) {
  const s = await w.createTask({ ...req(), skuId, boxesTarget, employeeId });
  const t = s.tasks.find((x) => x.skuId === skuId)!;
  await w.claimTask(t.id, { ...req(), employeeId });
  return t;
}
function scan(t: D.TaskDto, kind: "source" | "box" | "barcode", value: string) {
  return w.scanTask(t.id, { ...req(), employeeId, kind, value });
}
async function open(t: D.TaskDto, source: D.PalletDto) {
  const current = (await w.snapshot()).tasks.find((x) => x.id === t.id)!;
  await scan(t, "source", source.code);
  await scan(t, "box", current.openBoxCode);
}
const versions = () =>
  w.authTransaction(
    async (tx) =>
      new Map(
        (
          await tx.query<{ location_id: string; version: string }>(
            "SELECT location_id,version FROM stocktake_cell_versions",
          )
        ).rows.map((r) => [r.location_id, Number(r.version)]),
      ),
  );
async function persisted() {
  return w.authTransaction(async (tx) => ({
    ledger: (await tx.query("SELECT * FROM stock_ledger ORDER BY id")).rows,
    work: (await tx.query("SELECT * FROM work_events ORDER BY id")).rows,
    cells: (
      await tx.query(
        "SELECT * FROM stocktake_cell_versions ORDER BY location_id",
      )
    ).rows,
    commands: (await tx.query("SELECT * FROM commands ORDER BY request_id"))
      .rows,
  }));
}
async function lower(pallet: D.PalletDto, source: D.LocationDto) {
  const target = await location("picking");
  let s = await w.createMovement({
    ...req(),
    palletId: pallet.id,
    employeeId,
    kind: "lower",
    toLocationId: target.id,
    keepSourceReserved: true,
  });
  const movement = s.movements.find((m) => m.palletId === pallet.id)!;
  await w.takeMovement(movement.id, {
    ...req(),
    palletCode: pallet.code,
    locationCode: source.code,
  });
  s = await w.placeMovement(movement.id, {
    ...req(),
    palletCode: pallet.code,
    locationCode: target.code,
  });
  assert.equal(
    s.pallets.find((p) => p.id === pallet.id)!.returnLocationId,
    source.id,
  );
  return target;
}

test("last unit frees a raw address mid-box, preserves receipt and mixed-lot FIFO, and leaves a partly consumed pallet stored", async () => {
  const old = await receive(10);
  const next = await receive(15, 20, old.sku.id, "2026-10-02T10:00:00Z");
  const t = await task(old.sku.id);
  const before = await w.snapshot();
  const receiptHistory = structuredClone(
    before.receipts.find((r) => r.id === old.receiptId),
  );
  const sourceBefore = structuredClone(
    before.pallets.find((p) => p.id === old.pallet.id)!,
  );
  const workBefore = (await w.getWorkHistory({})).total;
  const epoch = (await versions()).get(old.address.id)!;
  await open(t, old.pallet);
  for (let i = 0; i < 10; i++) await scan(t, "barcode", old.sku.barcode);
  let s = await w.snapshot();
  const empty = s.pallets.find((p) => p.id === old.pallet.id)!;
  assert.deepEqual(empty, {
    ...sourceBefore,
    quantity: 0,
    status: "retired",
    locationId: null,
    returnLocationId: null,
  });
  const progress = s.tasks.find((x) => x.id === t.id)!;
  assert.equal(progress.scannedUnits, 10);
  assert.equal(progress.sourcePalletId, null);
  assert.equal(progress.boxCodeConfirmed, true);
  assert.equal(progress.boxesCompleted, 0);
  assert.equal((await w.getWorkHistory({})).total, workBefore);
  assert.ok((await versions()).get(old.address.id)! > epoch);
  assert.equal(s.balance.totalUnits, before.balance.totalUnits);
  assert.deepEqual(
    s.receipts.find((r) => r.id === old.receiptId),
    receiptHistory,
  );
  assert.equal(placementError(s, old.address, next.pallet), null);
  // A real new receipt can use the released address before this mixed box closes.
  const replacement = await receive(3, 20, undefined, undefined, old.address);
  s = await w.snapshot();
  assert.equal(
    s.pallets.find((p) => p.id === replacement.pallet.id)!.locationId,
    old.address.id,
  );
  await assert.rejects(scan(t, "barcode", old.sku.barcode), /исходную паллету/);
  await scan(t, "source", next.pallet.code);
  for (let i = 0; i < 10; i++) await scan(t, "barcode", old.sku.barcode);
  s = await w.snapshot();
  const box = s.boxes.find((b) => b.code === t.openBoxCode)!;
  assert.deepEqual(box.lotContents, [
    { lotId: old.pallet.lotId, quantity: 10 },
    { lotId: next.pallet.lotId, quantity: 10 },
  ]);
  const remainder = s.pallets.find((p) => p.id === next.pallet.id)!;
  assert.equal(remainder.quantity, 5);
  assert.equal(remainder.status, "stored");
  assert.equal(remainder.locationId, next.address.id);
  assert.equal((await w.getStockLedger({})).summary.reconciled, true);
});

test("depleting a lowered raw pallet releases its physical address and held return address together", async () => {
  const old = await receive(2, 4);
  const next = await receive(2, 4, old.sku.id, "2026-10-02T10:00:00Z");
  const picking = await lower(old.pallet, old.address);
  const t = await task(old.sku.id);
  const before = await w.snapshot();
  assert.match(placementError(before, old.address, next.pallet)!, /возврата/);
  assert.match(placementError(before, picking, next.pallet)!, /занят/);
  await open(t, old.pallet);
  await scan(t, "barcode", old.sku.barcode);
  const beforeFinalUnit = await versions();
  const s = await scan(t, "barcode", old.sku.barcode);
  const empty = s.pallets.find((p) => p.id === old.pallet.id)!;
  assert.equal(empty.quantity, 0);
  assert.equal(empty.status, "retired");
  assert.equal(empty.locationId, null);
  assert.equal(empty.returnLocationId, null);
  const after = await versions();
  for (const l of [old.address, picking]) {
    assert.equal(placementError(s, l, next.pallet), null);
    assert.ok(after.get(l.id)! > beforeFinalUnit.get(l.id)!);
  }
  assert.equal(
    s.movements.find((m) => m.palletId === old.pallet.id)!.status,
    "completed",
  );
  await scan(t, "source", next.pallet.code);
  await scan(t, "barcode", old.sku.barcode);
  const closed = await scan(t, "barcode", old.sku.barcode);
  assert.equal(closed.tasks.find((x) => x.id === t.id)!.status, "completed");
  assert.equal((await w.getStockLedger({})).summary.reconciled, true);
});

test("failed last-unit packing rolls back raw retirement, both holds, ledger, versions and work; retry and replay count once", async () => {
  const stock = await receive(4, 2);
  const picking = await lower(stock.pallet, stock.address);
  const t = await task(stock.sku.id, 2);
  await open(t, stock.pallet);
  await scan(t, "barcode", stock.sku.barcode);
  let s = await scan(t, "barcode", stock.sku.barcode);
  const first = s.boxes.find((b) => b.code === t.openBoxCode)!;
  const accumulator = s.pallets.find((p) => p.id === first.palletId)!;
  await w.updateLocation(accumulator.locationId!, { ...req(), maxBoxes: 1 });
  await open(t, stock.pallet);
  await scan(t, "barcode", stock.sku.barcode);
  const before = await w.snapshot();
  const auditBefore = await persisted();
  const final = {
    ...req(),
    employeeId,
    kind: "barcode" as const,
    value: stock.sku.barcode,
  };
  await assert.rejects(w.scanTask(t.id, final), /вместимость|заполнена/);
  assert.deepEqual(await w.snapshot(), before);
  assert.deepEqual(await persisted(), auditBefore);
  const source = before.pallets.find((p) => p.id === stock.pallet.id)!;
  assert.equal(source.quantity, 1);
  assert.equal(source.status, "stored");
  assert.equal(source.locationId, picking.id);
  assert.equal(source.returnLocationId, stock.address.id);
  await w.updateLocation(accumulator.locationId!, { ...req(), maxBoxes: 2 });
  const auditReady = await persisted();
  s = await w.scanTask(t.id, final);
  const after = await persisted();
  assert.equal(
    s.pallets.find((p) => p.id === stock.pallet.id)!.status,
    "retired",
  );
  assert.equal(
    s.pallets.find((p) => p.id === stock.pallet.id)!.returnLocationId,
    null,
  );
  assert.equal(s.tasks.find((x) => x.id === t.id)!.boxesCompleted, 2);
  assert.equal(after.work.length, auditReady.work.length + 1);
  assert.equal(after.ledger.length, auditReady.ledger.length + 1);
  assert.equal(after.commands.length, auditReady.commands.length + 1);
  const stored = await w.snapshot();
  assert.deepEqual(await w.scanTask(t.id, final), s);
  assert.deepEqual(await persisted(), after);
  assert.deepEqual(await w.snapshot(), stored);
  assert.equal((await w.getStockLedger({})).summary.reconciled, true);
});

test("counting raw stock to zero keeps the physical pallet and return hold until explicit retirement", async () => {
  const stock = await receive(2, 2);
  const picking = await lower(stock.pallet, stock.address);
  const workBefore = (await w.getWorkHistory({})).total;
  const s = await w.adjustStock({
    ...req(),
    kind: "raw_count",
    targetId: stock.pallet.id,
    employeeId,
    expectedLocationId: picking.id,
    expectedQuantity: 2,
    countedQuantity: 0,
    reason: "Пересчитана пустая физическая паллета",
  });
  const empty = s.pallets.find((p) => p.id === stock.pallet.id)!;
  assert.equal(empty.quantity, 0);
  assert.equal(empty.status, "stored");
  assert.equal(empty.locationId, picking.id);
  assert.equal(empty.returnLocationId, stock.address.id);
  assert.match(placementError(s, picking, stock.pallet)!, /занят/);
  assert.match(placementError(s, stock.address, stock.pallet)!, /возврата/);
  assert.equal((await w.getWorkHistory({})).total, workBefore);
  const retired = await w.retireEmptyPallet(empty.id, {
    ...req(),
    palletCode: empty.code,
    locationCode: picking.code,
  });
  assert.equal(
    retired.pallets.find((p) => p.id === empty.id)!.status,
    "retired",
  );
  assert.equal(
    retired.pallets.find((p) => p.id === empty.id)!.returnLocationId,
    null,
  );
  assert.equal((await w.getWorkHistory({})).total, workBefore);
});
