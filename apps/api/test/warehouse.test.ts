import "reflect-metadata";
import { Client } from "pg";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WarehouseService } from "../src/warehouse.service";
import { WorkspaceDto } from "../src/dto";
import { assemblyPressure } from "../src/work-automation/assembly-pressure";
import { DEMO_PACKAGING } from "../src/physical";
const req = () => ({ requestId: randomUUID() });
let warehouse: WarehouseService;
function inventory(s: WorkspaceDto, skuId: string) {
  return (
    s.pallets
      .filter((p) => p.kind === "raw" && p.skuId === skuId)
      .reduce((v, p) => v + p.quantity, 0) +
    s.tasks
      .filter((t) => t.skuId === skuId)
      .reduce((v, t) => v + t.scannedUnits, 0) +
    s.boxes.filter((b) => b.skuId === skuId).reduce((v, b) => v + b.units, 0)
  );
}
before(async () => {
  if (process.env.WMS_TEST_DATABASE_URL) {
    const database =
      new Client({ connectionString: process.env.WMS_TEST_DATABASE_URL })
        .database ?? "";
    if (database === "artmate_wms" || !database.endsWith("_test"))
      throw new Error(
        "WMS_TEST_DATABASE_URL должен указывать только на отдельную базу с суффиксом _test",
      );
    process.env.DATABASE_URL = process.env.WMS_TEST_DATABASE_URL;
    delete process.env.WMS_DATA_DIR;
  } else process.env.WMS_DATA_DIR = "memory://";
  warehouse = new WarehouseService();
  await warehouse.updateWarehousePlan({ ...req(), width: 100, depth: 100 });
});
after(async () => warehouse?.onModuleDestroy());
// Test-only scenario helper: every existing stock fixture now goes through the two real commands.
async function receiveAndPlace(body: {
  requestId: string;
  skuId: string;
  quantity: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  weightKg?: number | null;
  locationId?: string;
}) {
  const { requestId, locationId, ...row } = body;
  const before = await warehouse.snapshot();
  const state = await warehouse.createReceipt({
    requestId,
    receivedAt: new Date().toISOString(),
    pallets: [row],
  });
  const cached = state.receipts.find(
    (r) => !before.receipts.some((old) => old.id === r.id),
  )!;
  const pallet = state.pallets.find(
    (p) => p.id === cached.pallets[0].palletId,
  )!;
  const options = await warehouse.getReceiptPlacementOptions(
    cached.id,
    pallet.id,
  );
  const location = state.locations.find(
    (l) => l.id === (locationId ?? options.suggestedLocationId),
  );
  if (!location) throw new Error(options.reason ?? "Нет подходящего адреса");
  const beforePlace = await warehouse.snapshot();
  try {
    return await warehouse.placeReceiptPallet(cached.id, pallet.id, {
      ...req(),
      employeeId: "employee-1",
      palletCode: pallet.code,
      locationCode: location.code,
    });
  } catch (error) {
    // A rejected place leaves the receipt and its awaiting pallet exactly as before that place.
    assert.deepEqual(await warehouse.snapshot(), beforePlace);
    throw error;
  }
}
async function putAwayBox(code: string, employeeId = "employee-3") {
  let s = await warehouse.snapshot();
  const box = s.boxes.find((b) => b.code === code)!;
  const task = s.putawayTasks.find(
    (t) => t.boxId === box.id && t.status !== "completed",
  )!;
  s = await warehouse.claimPutawayTask(task.id, { ...req(), employeeId });
  const current = s.putawayTasks.find((t) => t.id === task.id)!;
  const from = s.locations.find((l) => l.id === current.fromLocationId)!,
    to = s.locations.find((l) => l.id === current.toLocationId)!;
  await warehouse.takePutawayTask(task.id, {
    ...req(),
    employeeId,
    boxCode: box.code,
    locationCode: from.code,
  });
  return warehouse.placePutawayTask(task.id, {
    ...req(),
    employeeId,
    boxCode: box.code,
    locationCode: to.code,
  });
}
test("FIFO reserves old remainder, conserves raw + work in progress + boxes, allows a mixed box", async () => {
  const initial = await warehouse.snapshot(),
    total = inventory(initial, "sku-cats");
  let state = await warehouse.createTask({
    ...req(),
    skuId: "sku-cats",
    boxesTarget: 2,
    employeeId: "employee-1",
  });
  const [first, second] = state.tasks.filter(
    (t) => !initial.tasks.some((old) => old.id === t.id),
  );
  assert.deepEqual([first.boxesTarget, second.boxesTarget], [1, 1]);
  assert.deepEqual(
    first.reservations.map((r) => r.quantity),
    [20],
  );
  assert.deepEqual(
    second.reservations.map((r) => r.quantity),
    [10, 10],
  );
  let task = first;
  await warehouse.updateTaskStatus(task.id, {
    ...req(),
    status: "active",
    employeeId: "employee-1",
  });
  const scan = (kind: "source" | "box" | "barcode", value: string) =>
    warehouse.scanTask(task.id, {
      ...req(),
      employeeId: "employee-1",
      kind,
      value,
    });
  await assert.rejects(scan("source", "PLT-005"), /FIFO/);
  await scan("source", "PLT-001");
  await assert.rejects(scan("barcode", "4601234000011"), /короба/);
  await scan("box", task.openBoxCode);
  await assert.rejects(scan("barcode", "wrong"), /тематика/);
  const firstCode = task.openBoxCode;
  for (let i = 0; i < 20; i++) state = await scan("barcode", "4601234000011");
  assert.equal(inventory(state, "sku-cats"), total);
  assert.equal(state.tasks.find((t) => t.id === task.id)!.boxesCompleted, 1);
  assert.equal(state.tasks.find((t) => t.id === task.id)!.scannedUnits, 0);
  assert.equal(state.tasks.find((t) => t.id === first.id)!.status, "completed");
  assert.equal(state.tasks.find((t) => t.id === second.id)!.status, "queued");
  await assert.rejects(scan("barcode", "4601234000011"), /начните/);
  task = second;
  const secondCode = second.openBoxCode;
  await warehouse.claimTask(second.id, { ...req(), employeeId: "employee-1" });
  await assert.rejects(scan("box", firstCode), /текущего короба/);
  await assert.rejects(scan("box", secondCode), /исходную паллету/);
  await scan("source", "PLT-001");
  await scan("box", secondCode);
  for (let i = 0; i < 10; i++) state = await scan("barcode", "4601234000011");
  await assert.rejects(scan("barcode", "4601234000011"), /исходную паллету/);
  await scan("source", "PLT-005");
  for (let i = 0; i < 10; i++) state = await scan("barcode", "4601234000011");
  assert.deepEqual(
    state.boxes
      .find((b) => b.code === secondCode)!
      .lotContents.map((c) => c.quantity),
    [10, 10],
  );
  assert.equal(state.tasks.find((t) => t.id === task.id)!.status, "completed");
  assert.equal(inventory(state, "sku-cats"), total);
  assert.equal(
    state.employees.find((e) => e.id === "employee-1")!.boxesToday,
    2,
  );
});
test("command replay is idempotent and conflicting reuse is rejected", async () => {
  const body = { ...req(), skuId: "sku-space", boxesTarget: 1 };
  const first = await warehouse.createTask(body);
  const second = await warehouse.createTask(body);
  assert.deepEqual(first, second);
  await assert.rejects(
    warehouse.createTask({ ...body, boxesTarget: 2 }),
    /requestId/,
  );
});
test("concurrent batches of single-box work cannot exceed the theme queue limit", async () => {
  const calls = await Promise.allSettled([
    warehouse.createTask({ ...req(), skuId: "sku-flowers", boxesTarget: 3 }),
    warehouse.createTask({ ...req(), skuId: "sku-flowers", boxesTarget: 3 }),
  ]);
  assert.equal(calls.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(calls.filter((x) => x.status === "rejected").length, 1);
});
test("partial shipment ships requested boxes and preserves remaining pallet quantity", async () => {
  const before = await warehouse.snapshot();
  const original = before.pallets.find(
    (p) => p.id === "pallet-finished-1",
  )!.quantity;
  let s = await warehouse.createShipment({
    ...req(),
    skuId: "sku-space",
    boxesRequested: 5,
  });
  const shipment = s.shipments.find(
    (x) => !before.shipments.some((old) => old.id === x.id),
  )!;
  assert.equal(shipment.boxIds.length, 5);
  await assert.rejects(warehouse.shipShipment(shipment.id, req()), /Сначала/);
  s = await warehouse.createMovement({
    ...req(),
    palletId: "pallet-finished-1",
    toLocationId: "loc-picking",
    kind: "lower",
    employeeId: "employee-3",
    keepSourceReserved: true,
  });
  const movement = s.movements.find(
    (m) => m.palletId === "pallet-finished-1" && m.status === "planned",
  )!;
  const source = s.locations.find((l) => l.id === movement.fromLocationId)!;
  s = await warehouse.takeMovement(movement.id, {
    ...req(),
    palletCode: "FG-002",
    locationCode: source.code,
  });
  assert.equal(
    s.pallets.find((p) => p.id === "pallet-finished-1")!.locationId,
    null,
  );
  assert.ok(
    s.boxes
      .filter((b) => b.palletId === "pallet-finished-1")
      .every((b) => b.locationId === null),
  );
  await assert.rejects(warehouse.shipShipment(shipment.id, req()), /Сначала/);
  await assert.rejects(
    warehouse.placeMovement(movement.id, {
      ...req(),
      palletCode: "wrong",
      locationCode: "PICK-01",
    }),
    /Неверный/,
  );
  s = await warehouse.placeMovement(movement.id, {
    ...req(),
    palletCode: "FG-002",
    locationCode: "PICK-01",
  });
  s = await warehouse.shipShipment(shipment.id, req());
  s = await warehouse.createMovement({
    ...req(),
    palletId: "pallet-finished-1",
    toLocationId: source.id,
    kind: "return",
    employeeId: "employee-3",
  });
  const returning = s.movements.find(
    (m) => m.palletId === "pallet-finished-1" && m.status === "planned",
  )!;
  await warehouse.takeMovement(returning.id, {
    ...req(),
    palletCode: "FG-002",
    locationCode: "PICK-01",
  });
  s = await warehouse.placeMovement(returning.id, {
    ...req(),
    palletCode: "FG-002",
    locationCode: source.code,
  });
  assert.equal(
    s.pallets.find((p) => p.id === "pallet-finished-1")!.returnLocationId,
    null,
  );
  assert.equal(
    s.pallets.find((p) => p.id === "pallet-finished-1")!.quantity,
    original - 5,
  );
  assert.equal(
    s.boxes.filter((b) => b.skuId === "sku-space" && b.status === "shipped")
      .length,
    5,
  );
  assert.equal(inventory(s, "sku-space"), inventory(before, "sku-space"));
});
test("receipt placement rejects insufficient height and occupied addresses atomically", async () => {
  await warehouse.createLocation({
    ...locationBody("RECEIPT-TALL"),
    x: 30,
    y: 10,
  });
  const before = await warehouse.snapshot();
  await assert.rejects(
    receiveAndPlace({
      ...req(),
      skuId: "sku-cats",
      quantity: 1000,
      widthMm: 1200,
      depthMm: 800,
      heightMm: 2000,
      locationId: "loc-10",
    }),
    /высоте|высоты|занят/,
  );
  await assert.rejects(
    receiveAndPlace({
      ...req(),
      skuId: "sku-cats",
      quantity: 1000,
      widthMm: 1200,
      depthMm: 800,
      heightMm: 800,
      locationId: "loc-2",
    }),
    /высоте|высоты|занят/,
  );
  assert.equal(
    (await warehouse.snapshot()).lots.length,
    before.lots.length + 2,
  );
  assert.equal(
    (await warehouse.snapshot()).balance.totalUnits,
    before.balance.totalUnits,
  );
  const s = await receiveAndPlace({
    ...req(),
    skuId: "sku-cats",
    quantity: 1000,
    widthMm: 1200,
    depthMm: 800,
    heightMm: 1800,
  });
  const added = s.pallets.find(
    (p) =>
      p.status === "stored" && !before.pallets.some((old) => old.id === p.id),
  )!;
  assert.ok(
    s.locations.find((l) => l.id === added.locationId)!.maxHeightMm >= 1800,
  );
});
test("label is a real SVG QR with stable entity payload", async () => {
  const label = await warehouse.getLabel("location", "loc-1");
  assert.equal(label.payload, "artmate-wms:location:loc-1");
  assert.match(label.svg, /<svg/);
});

test("GET snapshot is stable and returns no fabricated live counters", async () => {
  assert.deepEqual(await warehouse.snapshot(), await warehouse.snapshot());
});
test("strict HTTP DTO validation rejects unknown fields, nulls and fractional quantities", async () => {
  const { ValidationPipe } = await import("@nestjs/common");
  const { CreateReceiptDto, UpdateLocationDto } = await import("../src/dto");
  const pipe = new ValidationPipe({
    expectedType: CreateReceiptDto,
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata = { type: "body" as const };
  await assert.rejects(
    pipe.transform(
      {
        ...req(),
        receivedAt: new Date().toISOString(),
        pallets: [{ skuId: "sku-cats", quantity: 1.2, heightMm: 1500 }],
      },
      metadata,
    ),
  );
  await assert.rejects(
    pipe.transform(
      {
        ...req(),
        receivedAt: new Date().toISOString(),
        pallets: [{ skuId: "sku-cats", quantity: 100, extra: "injected" }],
      },
      metadata,
    ),
  );
  const update = new ValidationPipe({
    expectedType: UpdateLocationDto,
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  await assert.rejects(
    update.transform({ ...req(), maxHeightMm: null }, metadata),
  );
});
test(
  "separate PostgreSQL clients serialize reservations and see persisted state",
  { skip: !process.env.WMS_TEST_DATABASE_URL },
  async () => {
    const first = new WarehouseService();
    const second = new WarehouseService();
    try {
      const priorRevision = (await first.snapshot()).revision;
      const results = await Promise.allSettled([
        first.createTask({ ...req(), skuId: "sku-dinos", boxesTarget: 3 }),
        second.createTask({ ...req(), skuId: "sku-dinos", boxesTarget: 3 }),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(results.filter((r) => r.status === "rejected").length, 1);
      assert.deepEqual(await first.snapshot(), await second.snapshot());
      assert.equal((await second.snapshot()).revision, priorRevision + 1);
    } finally {
      await first.onModuleDestroy();
      await second.onModuleDestroy();
    }
  },
);

let freePosition = 0;
const locationBody = (code: string, kind = "floor") => ({
  ...req(),
  code,
  name: code,
  kind,
  x: 30 + freePosition++ * 5,
  y: 30,
  width: 2,
  depth: 2,
  levels: 1,
  maxHeightMm: 2500,
  maxBoxes: 36,
  availableWidthMm: 1400,
  availableDepthMm: 1000,
  accessSides: kind === "picking" ? 4 : 1,
});
const receiptBody = (locationId: string, extra = {}) => ({
  ...req(),
  skuId: "sku-cats",
  quantity: 20,
  widthMm: 1200,
  depthMm: 800,
  heightMm: 900,
  locationId,
  ...extra,
});
test("counted-zero stock preserves physical occupation until scanned empty pallet retirement", async () => {
  // Depletion during assembly releases the former pallet. A physical zero here
  // must come from an explicit count, which does not imply a pallet was removed.
  let s = await warehouse.createLocation({
    ...locationBody("COUNTED-ZERO"),
    x: 90,
    y: 40,
  });
  const address = s.locations.find((l) => l.code === "COUNTED-ZERO")!;
  s = await receiveAndPlace(receiptBody(address.id));
  const physical = s.pallets.find(
    (p) => p.status === "stored" && p.locationId === address.id,
  )!;
  s = await warehouse.adjustStock({
    ...req(),
    kind: "raw_count",
    targetId: physical.id,
    employeeId: "employee-1",
    expectedLocationId: address.id,
    expectedQuantity: physical.quantity,
    countedQuantity: 0,
    reason: "Пересчитана пустая физическая паллета",
  });
  const empty = s.pallets.find((p) => p.id === physical.id)!;
  assert.equal(empty.quantity, 0);
  assert.equal(empty.status, "stored");
  await assert.rejects(
    receiveAndPlace(receiptBody(empty.locationId!)),
    /занят/,
  );
  await assert.rejects(
    warehouse.retireEmptyPallet(empty.id, {
      ...req(),
      palletCode: "wrong",
      locationCode: "A-01-01",
    }),
    /Неверный/,
  );
  s = await warehouse.retireEmptyPallet(empty.id, {
    ...req(),
    palletCode: empty.code,
    locationCode: s.locations.find((l) => l.id === empty.locationId)!.code,
  });
  assert.equal(s.pallets.find((p) => p.id === empty.id)!.locationId, null);
  assert.equal(s.pallets.find((p) => p.id === empty.id)!.status, "retired");
  s = await receiveAndPlace(receiptBody(empty.locationId!));
  assert.ok(
    s.pallets.some(
      (p) => p.id !== empty.id && p.locationId === empty.locationId,
    ),
  );
});
test("real rack levels have independent addresses, capacity and synchronized geometry", async () => {
  const before = await warehouse.snapshot();
  let s = await warehouse.createRackSection({
    ...req(),
    code: "TEST-RACK",
    name: "Тестовая секция",
    x: 30,
    y: 20,
    width: 3,
    depth: 2,
    levels: [
      {
        code: "TEST-RACK-1",
        name: "Ярус1",
        maxHeightMm: 1000,
        maxBoxes: 12,
        availableWidthMm: 1400,
        availableDepthMm: 1000,
      },
      {
        code: "TEST-RACK-2",
        name: "Ярус2",
        maxHeightMm: 2000,
        maxBoxes: 24,
        availableWidthMm: 1400,
        availableDepthMm: 1000,
      },
    ],
  });
  const section = s.sections.find(
    (x) => !before.sections.some((old) => old.id === x.id),
  )!;
  const levels = s.locations
    .filter((l) => l.sectionId === section.id)
    .sort((a, b) => a.level - b.level);
  assert.equal(levels.length, 2);
  s = await receiveAndPlace(receiptBody(levels[0].id));
  s = await receiveAndPlace(receiptBody(levels[1].id, { heightMm: 1800 }));
  assert.equal(
    s.pallets.filter((p) => levels.some((l) => l.id === p.locationId)).length,
    2,
  );
  await assert.rejects(
    warehouse.updateLocation(levels[1].id, { ...req(), maxHeightMm: 900 }),
    /высоте/,
  );
  s = await warehouse.updateRackSection(section.id, { ...req(), x: 50, y: 20 });
  assert.ok(
    s.locations
      .filter((l) => l.sectionId === section.id)
      .every((l) => l.x === 50 && l.y === 20),
  );
  s = await warehouse.createRackLevel(section.id, {
    ...req(),
    code: "TEST-RACK-3",
    name: "Ярус3",
    maxHeightMm: 1200,
    maxBoxes: 12,
    availableWidthMm: 1400,
    availableDepthMm: 1000,
  });
  assert.equal(s.locations.find((l) => l.code === "TEST-RACK-3")!.level, 3);
});
test("physical placement checks rotation, dimensions and unknown or excessive weight", async () => {
  let s = await warehouse.createLocation({
    ...locationBody("TEST-WEIGHT"),
    availableWidthMm: 1000,
    availableDepthMm: 1400,
    maxWeightKg: 500,
  });
  const l = s.locations.find((l) => l.code === "TEST-WEIGHT")!;
  await assert.rejects(receiveAndPlace(receiptBody(l.id)), /известная масса/);
  await assert.rejects(
    receiveAndPlace(receiptBody(l.id, { weightKg: 600 })),
    /масса/,
  );
  await assert.rejects(
    receiveAndPlace(
      receiptBody(l.id, { widthMm: 1500, depthMm: 1100, weightKg: 200 }),
    ),
    /ширине/,
  );
  s = await receiveAndPlace(receiptBody(l.id, { weightKg: 200 }));
  assert.ok(s.pallets.some((p) => p.locationId === l.id));
  await assert.rejects(
    warehouse.updateLocation(l.id, { ...req(), maxWeightKg: 100 }),
    /масса/,
  );
  await assert.rejects(
    warehouse.updateLocation(l.id, { ...req(), availableDepthMm: 600 }),
    /ширине/,
  );
});
test("movement take/place requires exact scans, holds target and return addresses atomically", async () => {
  let s = await warehouse.createLocation(locationBody("TEST-PICK", "picking"));
  const target = s.locations.find((l) => l.code === "TEST-PICK")!;
  const pallet = s.pallets.find((p) => p.id === "pallet-finished-0")!;
  const source = s.locations.find((l) => l.id === pallet.locationId)!;
  s = await warehouse.createMovement({
    ...req(),
    palletId: pallet.id,
    toLocationId: target.id,
    kind: "lower",
    employeeId: "employee-3",
    keepSourceReserved: true,
  });
  const m = s.movements.find(
    (m) => m.palletId === pallet.id && m.status === "planned",
  )!;
  await assert.rejects(
    warehouse.createMovement({
      ...req(),
      palletId: "pallet-finished-2",
      toLocationId: target.id,
      kind: "lower",
      employeeId: "employee-3",
    }),
    /зарезервирован/,
  );
  await assert.rejects(
    warehouse.updateLocation(target.id, { ...req(), maxHeightMm: 100 }),
    /высоте/,
  );
  const before = await warehouse.snapshot();
  await assert.rejects(
    warehouse.takeMovement(m.id, {
      ...req(),
      palletCode: pallet.code,
      locationCode: "wrong",
    }),
    /Неверный/,
  );
  assert.deepEqual(await warehouse.snapshot(), before);
  s = await warehouse.takeMovement(m.id, {
    ...req(),
    palletCode: pallet.code,
    locationCode: source.code,
  });
  assert.equal(
    s.pallets.find((p) => p.id === pallet.id)!.returnLocationId,
    source.id,
  );
  await assert.rejects(receiveAndPlace(receiptBody(source.id)), /возврата/);
  await assert.rejects(
    warehouse.updateLocation(source.id, { ...req(), availableWidthMm: 100 }),
    /ширине/,
  );
  await assert.rejects(warehouse.cancelMovement(m.id, req()), /до забора/);
  const transit = await warehouse.snapshot();
  await assert.rejects(
    warehouse.placeMovement(m.id, {
      ...req(),
      palletCode: pallet.code,
      locationCode: source.code,
    }),
    /Неверный/,
  );
  assert.deepEqual(await warehouse.snapshot(), transit);
  s = await warehouse.placeMovement(m.id, {
    ...req(),
    palletCode: `artmate-wms:pallet:${pallet.id}`,
    locationCode: `artmate-wms:location:${target.id}`,
  });
  assert.ok(
    s.boxes
      .filter((b) => b.palletId === pallet.id && b.status === "stored")
      .every((b) => b.locationId === target.id),
  );
});
test("raw pallet task reservations prevent relocation and planned moves prevent new source reservation", async () => {
  let s = await warehouse.createLocation(locationBody("TEST-TRANSFER"));
  const target = s.locations.find((l) => l.code === "TEST-TRANSFER")!;
  await assert.rejects(
    warehouse.createMovement({
      ...req(),
      palletId: "pallet-raw-1",
      toLocationId: target.id,
      kind: "transfer",
      employeeId: "employee-3",
    }),
    /зарезервирована/,
  );
  const raw = await assemblyStock("MOVE-ONLY-RAW", 2, 2);
  s = await warehouse.createMovement({
    ...req(),
    palletId: raw.p.id,
    toLocationId: target.id,
    kind: "transfer",
    employeeId: "employee-3",
  });
  const m = s.movements.find(
    (m) => m.palletId === raw.p.id && m.status === "planned",
  )!;
  await assert.rejects(
    warehouse.createTask({ ...req(), skuId: raw.skuId!, boxesTarget: 1 }),
    /Недостаточно/,
  );
  s = await warehouse.cancelMovement(m.id, req());
  assert.equal(s.movements.find((x) => x.id === m.id)!.status, "cancelled");
});
test("packaging validates real layer geometry and keeps historic dimensions immutable", async () => {
  let s = await warehouse.snapshot();
  const sku = s.skus.find((x) => x.id === "sku-cats")!;
  const original = structuredClone(s.boxes.find((b) => b.skuId === sku.id)!);
  await assert.rejects(
    warehouse.updateSkuPackaging(sku.id, {
      ...req(),
      packaging: { ...sku.packaging, boxesPerLayer: 7 },
    }),
    /слой/,
  );
  s = await warehouse.updateSkuPackaging(sku.id, {
    ...req(),
    packaging: { ...sku.packaging, boxHeightMm: 250, maxLayers: 4 },
  });
  assert.deepEqual(
    s.boxes.find((b) => b.id === original.id)!.packagingSnapshot,
    original.packagingSnapshot,
  );
  await assert.rejects(
    warehouse.updateSkuPackaging("sku-space", {
      ...req(),
      packaging: sku.packaging,
    }),
    /завершите задания/,
  );
});
test("two pallets of one SKU ship through one picking position without losing held return addresses", async () => {
  const existingTasks = new Set(
    (await warehouse.snapshot()).tasks.map((t) => t.id),
  );
  let s = await warehouse.createTask({
    ...req(),
    skuId: "sku-dinos",
    boxesTarget: 1,
    employeeId: "employee-2",
  });
  const task = s.tasks.find((t) => !existingTasks.has(t.id))!;
  await warehouse.updateTaskStatus(task.id, {
    ...req(),
    employeeId: "employee-2",
    status: "active",
  });
  const source = s.pallets.find((p) => p.id === task.reservations[0].palletId)!;
  await warehouse.scanTask(task.id, {
    ...req(),
    employeeId: "employee-2",
    kind: "source",
    value: source.code,
  });
  await warehouse.scanTask(task.id, {
    ...req(),
    employeeId: "employee-2",
    kind: "box",
    value: task.openBoxCode,
  });
  for (let i = 0; i < 20; i++)
    s = await warehouse.scanTask(task.id, {
      ...req(),
      employeeId: "employee-2",
      kind: "barcode",
      value: "4601234000035",
    });
  // Hold the old thematic pallet outside storage, so the new box needs a distinct storage pallet.
  const old = s.pallets.find((p) => p.id === "pallet-finished-2")!,
    oldAddress = old.locationId!;
  const tempMove = async (to: string, kind: string) => {
    let state = await warehouse.createMovement({
      ...req(),
      palletId: old.id,
      toLocationId: to,
      kind,
      employeeId: "employee-3",
      ...(kind === "lower" ? { keepSourceReserved: true } : {}),
    });
    const m = state.movements.find(
      (m) => m.palletId === old.id && m.status === "planned",
    )!;
    await warehouse.takeMovement(m.id, {
      ...req(),
      palletCode: old.code,
      locationCode: state.locations.find((l) => l.id === m.fromLocationId)!
        .code,
    });
    return warehouse.placeMovement(m.id, {
      ...req(),
      palletCode: old.code,
      locationCode: state.locations.find((l) => l.id === to)!.code,
    });
  };
  await tempMove("loc-picking", "lower");
  s = await putAwayBox(task.openBoxCode);
  s = await tempMove(oldAddress, "return");
  const second = s.pallets.find(
    (p) =>
      p.skuId === "sku-dinos" &&
      p.kind === "finished" &&
      p.id !== "pallet-finished-2",
  )!;
  const first = s.pallets.find((p) => p.id === "pallet-finished-2")!;
  const firstReturn = first.locationId!,
    secondReturn = second.locationId!;
  const move = async (palletId: string, toLocationId: string, kind: string) => {
    let state = await warehouse.createMovement({
      ...req(),
      palletId,
      toLocationId,
      kind,
      employeeId: "employee-3",
      ...(kind === "lower" ? { keepSourceReserved: true } : {}),
    });
    const movement = state.movements.find(
      (m) => m.palletId === palletId && m.status === "planned",
    )!;
    const pallet = state.pallets.find((p) => p.id === palletId)!;
    await warehouse.takeMovement(movement.id, {
      ...req(),
      palletCode: pallet.code,
      locationCode: state.locations.find(
        (l) => l.id === movement.fromLocationId,
      )!.code,
    });
    return warehouse.placeMovement(movement.id, {
      ...req(),
      palletCode: pallet.code,
      locationCode: state.locations.find((l) => l.id === toLocationId)!.code,
    });
  };
  s = await move(first.id, "loc-picking", "lower");
  await assert.rejects(
    warehouse.createMovement({
      ...req(),
      palletId: first.id,
      toLocationId: firstReturn,
      kind: "transfer",
      employeeId: "employee-3",
    }),
    /оформите возврат/,
  );
  s = await move(first.id, "loc-shipping", "transfer");
  assert.equal(
    s.pallets.find((p) => p.id === first.id)!.returnLocationId,
    firstReturn,
  );
  s = await move(second.id, "loc-picking", "lower");
  assert.equal(
    s.pallets.find((p) => p.id === second.id)!.returnLocationId,
    secondReturn,
  );
  s = await warehouse.createShipment({
    ...req(),
    skuId: "sku-dinos",
    boxesRequested: 9,
  });
  const shipment = s.shipments.find(
    (x) => x.skuId === "sku-dinos" && x.status === "draft",
  )!;
  s = await warehouse.shipShipment(shipment.id, req());
  assert.equal(s.pallets.find((p) => p.id === first.id)!.quantity, 0);
  assert.equal(s.pallets.find((p) => p.id === second.id)!.quantity, 0);
  s = await move(first.id, firstReturn, "return");
  s = await move(second.id, secondReturn, "return");
  for (const [id, target] of [
    [first.id, firstReturn],
    [second.id, secondReturn],
  ]) {
    const p = s.pallets.find((p) => p.id === id)!;
    assert.equal(p.locationId, target);
    assert.equal(p.returnLocationId, null);
    assert.equal(p.status, "stored");
  }
});

test("transformed HTTP section partial DTO preserves omitted fields and child address geometry", async () => {
  const { ValidationPipe } = await import("@nestjs/common");
  const { WarehouseController } = await import("../src/app");
  const { UpdateRackSectionDto } = await import("../src/dto");
  const controller = new WarehouseController(warehouse);
  let state = await warehouse.createRackSection({
    ...req(),
    code: "HTTP-PARTIAL-SECTION",
    name: "Секция для HTTP регрессии",
    x: 60,
    y: 20,
    width: 3,
    depth: 4,
    levels: [
      {
        code: "HTTP-PARTIAL-L1",
        name: "Ярус 1",
        maxHeightMm: 1200,
        maxBoxes: 12,
        availableWidthMm: 1400,
        availableDepthMm: 1000,
        maxWeightKg: 500,
      },
      {
        code: "HTTP-PARTIAL-L2",
        name: "Ярус 2",
        maxHeightMm: 2200,
        maxBoxes: 24,
        availableWidthMm: 1400,
        availableDepthMm: 1000,
        maxWeightKg: 700,
      },
    ],
  });
  const original = structuredClone(
    state.sections.find((s) => s.code === "HTTP-PARTIAL-SECTION")!,
  );
  const children = structuredClone(
    state.locations.filter((l) => l.sectionId === original.id),
  );
  const body = await new ValidationPipe({
    expectedType: UpdateRackSectionDto,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }).transform({ ...req(), x: 70, y: 20 }, { type: "body" });
  const pipe = new ValidationPipe({
    expectedType: UpdateRackSectionDto,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  for (const field of ["code", "name", "x", "y", "width", "depth", "rotation"])
    await assert.rejects(
      pipe.transform({ ...req(), [field]: null }, { type: "body" }),
      (error: any) => error.getStatus?.() === 400,
      `null section.${field} must return 400`,
    );
  assert.ok(body instanceof UpdateRackSectionDto);
  assert.ok(Object.hasOwn(body, "code"));
  assert.equal(body.code, undefined);
  state = await controller.updateRackSection(original.id, body);
  assert.deepEqual(
    state.sections.find((s) => s.id === original.id),
    { ...original, x: 70, y: 20 },
  );
  for (const child of children)
    assert.deepEqual(
      state.locations.find((l) => l.id === child.id),
      { ...child, x: 70, y: 20 },
    );
  const persisted = await warehouse.snapshot();
  assert.deepEqual(
    persisted.sections.find((s) => s.id === original.id),
    { ...original, x: 70, y: 20 },
  );
});

test("transformed HTTP location partial DTO preserves limits and kind while explicit null resets nullable limit", async () => {
  const { ValidationPipe } = await import("@nestjs/common");
  const { WarehouseController } = await import("../src/app");
  const { UpdateLocationDto } = await import("../src/dto");
  const controller = new WarehouseController(warehouse);
  let state = await warehouse.createLocation({
    ...locationBody("HTTP-PARTIAL-FLOOR"),
    maxWeightKg: 500,
  });
  const original = structuredClone(
    state.locations.find((l) => l.code === "HTTP-PARTIAL-FLOOR")!,
  );
  const pipe = new ValidationPipe({
    expectedType: UpdateLocationDto,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const body = await pipe.transform(
    { ...req(), x: 80, y: 30 },
    { type: "body" },
  );
  for (const field of [
    "code",
    "name",
    "kind",
    "x",
    "y",
    "width",
    "depth",
    "levels",
    "maxHeightMm",
    "maxBoxes",
    "availableWidthMm",
    "availableDepthMm",
    "accessSides",
    "blocked",
    "rotation",
  ])
    await assert.rejects(
      pipe.transform({ ...req(), [field]: null }, { type: "body" }),
      (error: any) => error.getStatus?.() === 400,
      `null location.${field} must return 400`,
    );
  assert.ok(body instanceof UpdateLocationDto);
  assert.ok(Object.hasOwn(body, "maxWeightKg"));
  assert.equal(body.maxWeightKg, undefined);
  state = await controller.updateLocation(original.id, body);
  assert.deepEqual(
    state.locations.find((l) => l.id === original.id),
    { ...original, x: 80, y: 30 },
  );
  const reset = await pipe.transform(
    { ...req(), maxWeightKg: null },
    { type: "body" },
  );
  state = await controller.updateLocation(original.id, reset);
  assert.deepEqual(
    state.locations.find((l) => l.id === original.id),
    { ...original, x: 80, y: 30, maxWeightKg: null },
  );
});

test("nullable receipt and packaging weights remain valid through HTTP DTO transformation", async () => {
  const { ValidationPipe } = await import("@nestjs/common");
  const { CreateReceiptDto, UpdateSkuPackagingDto } =
    await import("../src/dto");
  const receipt = await new ValidationPipe({
    expectedType: CreateReceiptDto,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }).transform(
    {
      ...req(),
      receivedAt: new Date().toISOString(),
      pallets: [
        {
          skuId: "sku-cats",
          quantity: 20,
          widthMm: 1200,
          depthMm: 800,
          heightMm: 900,
          weightKg: null,
        },
      ],
    },
    { type: "body" },
  );
  assert.equal(receipt.pallets[0].weightKg, null);
  const s = await warehouse.snapshot();
  const profile = await new ValidationPipe({
    expectedType: UpdateSkuPackagingDto,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }).transform(
    {
      ...req(),
      packaging: {
        ...s.skus[0].packaging,
        boxWeightKg: null,
        palletWeightKg: null,
      },
    },
    { type: "body" },
  );
  assert.equal(profile.packaging.boxWeightKg, null);
  assert.equal(profile.packaging.palletWeightKg, null);
});

test("rotated footprints respect bounds, touching edges and object collisions atomically", async () => {
  let s = await warehouse.createLocation({
    ...locationBody("GEOM-ROT"),
    x: 95,
    y: 50,
    width: 4,
    depth: 2,
    rotation: 90,
  });
  const first = s.locations.find((l) => l.code === "GEOM-ROT")!;
  s = await warehouse.createLocation({
    ...locationBody("GEOM-EDGE"),
    x: 97,
    y: 50,
    width: 3,
    depth: 2,
  });
  const before = await warehouse.snapshot();
  await assert.rejects(
    warehouse.updateLocation(first.id, { ...req(), rotation: 0 }),
    /пересекается/,
  );
  assert.deepEqual(await warehouse.snapshot(), before);
  s = await warehouse.createLocation({
    ...locationBody("GEOM-BOUND"),
    x: 98,
    y: 60,
    width: 4,
    depth: 2,
    rotation: 90,
  });
  const bound = s.locations.find((l) => l.code === "GEOM-BOUND")!;
  await assert.rejects(
    warehouse.updateLocation(bound.id, { ...req(), rotation: 0 }),
    /границы/,
  );
  await assert.rejects(
    warehouse.updateWarehousePlan({ ...req(), width: 99 }),
    /границы/,
  );
  s = await warehouse.updateLocation(bound.id, { ...req(), rotation: 270 });
  assert.equal(s.locations.find((l) => l.id === bound.id)!.rotation, 270);
});
test("aisles may cross each other but prohibit storage collisions and mirror rack rotation to all levels", async () => {
  let s = await warehouse.createAisle({
    ...req(),
    name: "Главный проход",
    x: 0,
    y: 40,
    width: 60,
    depth: 2,
  });
  const aisle = s.aisles.at(-1)!;
  s = await warehouse.createAisle({
    ...req(),
    name: "Поперечный проход",
    x: 10,
    y: 35,
    width: 2,
    depth: 10,
  });
  assert.equal(s.aisles.length, 2);
  await assert.rejects(
    warehouse.createLocation({ ...locationBody("IN-AISLE"), x: 20, y: 40 }),
    /пересекается/,
  );
  s = await warehouse.createRackSection({
    ...req(),
    code: "GEOM-SECTION",
    name: "Поворотная секция",
    x: 60,
    y: 50,
    width: 4,
    depth: 2,
    levels: [
      {
        code: "GEOM-L1",
        name: "Первый",
        maxHeightMm: 1000,
        maxBoxes: 12,
        availableWidthMm: 1400,
        availableDepthMm: 1000,
      },
      {
        code: "GEOM-L2",
        name: "Второй",
        maxHeightMm: 2000,
        maxBoxes: 24,
        availableWidthMm: 1400,
        availableDepthMm: 1000,
      },
    ],
  });
  const section = s.sections.find((x) => x.code === "GEOM-SECTION")!;
  s = await warehouse.updateRackSection(section.id, { ...req(), rotation: 90 });
  assert.ok(
    s.locations
      .filter((l) => l.sectionId === section.id)
      .every(
        (l) =>
          l.x === 60 &&
          l.y === 50 &&
          l.width === 4 &&
          l.depth === 2 &&
          l.rotation === 90 &&
          l.availableWidthMm === 1400,
      ),
  );
  const before = await warehouse.snapshot();
  await assert.rejects(
    warehouse.updateRackSection(section.id, { ...req(), x: 99 }),
    /границы/,
  );
  assert.deepEqual(await warehouse.snapshot(), before);
  await assert.rejects(
    warehouse.updateLocation(
      s.locations.find((l) => l.sectionId === section.id)!.id,
      { ...req(), rotation: 180 },
    ),
    /редактор секции/,
  );
  await assert.rejects(
    warehouse.updateAisle(aisle.id, {
      ...req(),
      y: 50,
      x: 60,
      width: 2,
      depth: 2,
    }),
    /пересекается/,
  );
});
test("wall entrances enforce edges, adjacency, overlap and room shrink without losing IDs", async () => {
  let s = await warehouse.createEntrance({
    ...req(),
    name: "Северный вход",
    wall: "north",
    offset: 0,
    width: 3,
  });
  const first = s.entrances.at(-1)!;
  s = await warehouse.createEntrance({
    ...req(),
    name: "Соседний вход",
    wall: "north",
    offset: 3,
    width: 2,
  });
  assert.equal(s.entrances.length, 2);
  await assert.rejects(
    warehouse.createEntrance({
      ...req(),
      name: "Перекрытие",
      wall: "north",
      offset: 2.5,
      width: 2,
    }),
    /перекрываться/,
  );
  await assert.rejects(
    warehouse.createEntrance({
      ...req(),
      name: "За стеной",
      wall: "west",
      offset: 99.7,
      width: 0.5,
    }),
    /стены/,
  );
  s = await warehouse.createEntrance({
    ...req(),
    name: "Восточный вход",
    wall: "east",
    offset: 95,
    width: 5,
  });
  const east = s.entrances.find((e) => e.wall === "east")!;
  await assert.rejects(
    warehouse.updateWarehousePlan({ ...req(), depth: 99 }),
    /стены/,
  );
  s = await warehouse.updateWarehousePlan({ ...req(), width: 101 });
  assert.deepEqual(
    s.entrances.find((e) => e.id === east.id),
    east,
  );
  await warehouse.updateWarehousePlan({ ...req(), width: 100 });
  await warehouse.deleteEntrance(first.id, req());
  s = await warehouse.createEntrance({
    ...req(),
    name: "Временный вход",
    wall: "north",
    offset: 0,
    width: 3,
  });
  const temporary = s.entrances.find((e) => e.name === "Временный вход")!;
  await assert.rejects(
    warehouse.restoreEntrance(first.id, req()),
    /перекрываться/,
  );
  await warehouse.deleteEntrance(temporary.id, req());
  s = await warehouse.restoreEntrance(first.id, req());
  assert.equal(s.entrances.find((e) => e.id === first.id)!.archived, false);
});
test("archive excludes direct commands, reserves codes and restores original ID QR and history only when geometry is free", async () => {
  let s = await warehouse.createLocation({
    ...locationBody("ARCHIVE-FLOOR"),
    x: 80,
    y: 75,
    width: 3,
    depth: 2,
  });
  const location = s.locations.find((l) => l.code === "ARCHIVE-FLOOR")!;
  const label = await warehouse.getLabel("location", location.id);
  const beforeActivityIds = s.activities.map((a) => a.id);
  const deletion = req();
  s = await warehouse.deleteLocation(location.id, deletion);
  const archived = s.locations.find((l) => l.id === location.id)!;
  assert.equal(archived.archived, true);
  assert.ok(archived.archivedAt);
  assert.match(
    (await warehouse.getLabel("location", location.id)).title,
    /Архив/,
  );
  await assert.rejects(
    warehouse.createLocation({ ...locationBody(location.code), x: 75, y: 80 }),
    /уже существует/,
  );
  await assert.rejects(receiveAndPlace(receiptBody(location.id)), /архив/);
  await assert.rejects(
    warehouse.updateLocation(location.id, { ...req(), name: "Попытка" }),
    /архив/,
  );
  await assert.rejects(
    warehouse.createMovement({
      ...req(),
      palletId: "pallet-finished-3",
      toLocationId: location.id,
      kind: "transfer",
      employeeId: "employee-3",
    }),
    /архив/,
  );
  s = await warehouse.createAisle({
    ...req(),
    name: "Занявший место проход",
    x: 80,
    y: 75,
    width: 3,
    depth: 2,
  });
  const aisle = s.aisles.find((a) => a.name === "Занявший место проход")!;
  await assert.rejects(
    warehouse.restoreLocation(location.id, req()),
    /пересекается/,
  );
  assert.equal(
    (await warehouse.snapshot()).locations.find((l) => l.id === location.id)!
      .archivedAt,
    archived.archivedAt,
  );
  await warehouse.deleteAisle(aisle.id, req());
  s = await warehouse.restoreLocation(location.id, req());
  assert.equal(s.locations.find((l) => l.id === location.id)!.archived, false);
  assert.equal(
    (await warehouse.getLabel("location", location.id)).payload,
    label.payload,
  );
  for (const id of beforeActivityIds)
    assert.ok(s.activities.some((a) => a.id === id));
  const oldReplay = await warehouse.deleteLocation(location.id, deletion);
  assert.equal(
    oldReplay.locations.find((l) => l.id === location.id)!.archived,
    true,
  );
  assert.equal(
    (await warehouse.snapshot()).locations.find((l) => l.id === location.id)!
      .archived,
    false,
  );
  await assert.rejects(warehouse.restoreAisle(aisle.id, req()), /пересекается/);
});
test("section basket restores only its previously active levels and supports an empty active section", async () => {
  let s = await warehouse.createRackSection({
    ...req(),
    code: "ARCHIVE-SECTION",
    name: "Группа архива",
    x: 85,
    y: 80,
    width: 3,
    depth: 2,
    levels: [1, 2, 3].map((level) => ({
      code: `ARCHIVE-L${level}`,
      name: `Ярус${level}`,
      maxHeightMm: 2000,
      maxBoxes: 18,
      availableWidthMm: 1400,
      availableDepthMm: 1000,
    })),
  });
  const section = s.sections.find((x) => x.code === "ARCHIVE-SECTION")!;
  const levels = s.locations
    .filter((l) => l.sectionId === section.id)
    .sort((a, b) => a.level - b.level);
  await warehouse.deleteLocation(levels[0].id, req());
  s = await warehouse.deleteRackSection(section.id, req());
  assert.deepEqual(
    [
      ...s.sections.find((x) => x.id === section.id)!.archivedLocationIds,
    ].sort(),
    levels
      .slice(1)
      .map((l) => l.id)
      .sort(),
  );
  await assert.rejects(
    warehouse.restoreLocation(levels[0].id, req()),
    /Секция.*архив/,
  );
  await assert.rejects(
    warehouse.createRackLevel(section.id, {
      ...req(),
      code: "ARCHIVE-BAD",
      name: "Архивный",
      maxHeightMm: 1000,
      maxBoxes: 12,
      availableWidthMm: 1400,
      availableDepthMm: 1000,
    }),
    /архив/,
  );
  s = await warehouse.restoreRackSection(section.id, req());
  assert.equal(s.locations.find((l) => l.id === levels[0].id)!.archived, true);
  assert.ok(
    s.locations
      .filter((l) => l.sectionId === section.id && l.id !== levels[0].id)
      .every((l) => !l.archived),
  );
  await warehouse.restoreLocation(levels[0].id, req());
  for (const level of levels) await warehouse.deleteLocation(level.id, req());
  s = await warehouse.createRackLevel(section.id, {
    ...req(),
    code: "ARCHIVE-L4",
    name: "Новый ярус",
    maxHeightMm: 1200,
    maxBoxes: 12,
    availableWidthMm: 1400,
    availableDepthMm: 1000,
  });
  assert.equal(s.sections.find((x) => x.id === section.id)!.archived, false);
  assert.equal(s.locations.find((l) => l.code === "ARCHIVE-L4")!.level, 4);
});
test("archive rejects empty physical pallets, held returns and both ends of an active move", async () => {
  let s = await warehouse.snapshot();
  const empty = s.pallets.find((p) => p.id === "pallet-finished-2")!;
  assert.equal(empty.quantity, 0);
  const source = s.locations.find((l) => l.id === empty.locationId)!;
  await assert.rejects(warehouse.deleteLocation(source.id, req()), /физически/);
  await assert.rejects(
    warehouse.deleteRackSection(source.sectionId!, req()),
    /физически/,
  );
  const held = s.pallets.find(
    (p) => p.id === "pallet-finished-0",
  )!.returnLocationId!;
  await assert.rejects(warehouse.deleteLocation(held, req()), /возврата/);
  s = await warehouse.createLocation({
    ...locationBody("ARCHIVE-MOVE-TARGET"),
    x: 70,
    y: 70,
  });
  const target = s.locations.find((l) => l.code === "ARCHIVE-MOVE-TARGET")!;
  s = await warehouse.createMovement({
    ...req(),
    palletId: empty.id,
    toLocationId: target.id,
    kind: "transfer",
    employeeId: "employee-3",
  });
  const movement = s.movements.find(
    (m) => m.palletId === empty.id && m.status === "planned",
  )!;
  await assert.rejects(
    warehouse.deleteLocation(target.id, req()),
    /активного перемещения/,
  );
  await warehouse.takeMovement(movement.id, {
    ...req(),
    palletCode: empty.code,
    locationCode: source.code,
  });
  await assert.rejects(
    warehouse.deleteLocation(source.id, req()),
    /активного перемещения/,
  );
  await assert.rejects(
    warehouse.deleteRackSection(source.sectionId!, req()),
    /активного перемещения/,
  );
  await warehouse.placeMovement(movement.id, {
    ...req(),
    palletCode: empty.code,
    locationCode: target.code,
  });
  s = await warehouse.deleteLocation(source.id, req());
  assert.equal(s.locations.find((l) => l.id === source.id)!.archived, true);
  await warehouse.restoreLocation(source.id, req());
});
test("builder partial DTOs preserve state after transform and reject optional nulls", async () => {
  const { ValidationPipe } = await import("@nestjs/common");
  const { WarehouseController } = await import("../src/app");
  const D = await import("../src/dto");
  const controller = new WarehouseController(warehouse);
  const planPipe = new ValidationPipe({
    expectedType: D.UpdateWarehousePlanDto,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const aislePipe = new ValidationPipe({
    expectedType: D.UpdateAisleDto,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const entrancePipe = new ValidationPipe({
    expectedType: D.UpdateEntranceDto,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  for (const [pipe, fields] of [
    [planPipe, ["name", "width", "depth"]],
    [aislePipe, ["name", "x", "y", "width", "depth", "rotation"]],
    [entrancePipe, ["name", "wall", "offset", "width"]],
  ] as const)
    for (const field of fields)
      await assert.rejects(
        pipe.transform({ ...req(), [field]: null }, { type: "body" }),
        (error: any) => error.getStatus?.() === 400,
      );
  let before = await warehouse.snapshot();
  let s = await controller.updateWarehousePlan(
    await planPipe.transform(
      { ...req(), name: "Склад после настройки" },
      { type: "body" },
    ),
  );
  assert.deepEqual(s.warehouse, {
    ...before.warehouse,
    name: "Склад после настройки",
  });
  const aisle = s.aisles.find((a) => a.name === "Поперечный проход")!;
  s = await controller.updateAisle(
    aisle.id,
    await aislePipe.transform({ ...req(), rotation: 180 }, { type: "body" }),
  );
  assert.deepEqual(
    s.aisles.find((a) => a.id === aisle.id),
    { ...aisle, rotation: 180 },
  );
  const entrance = s.entrances.find((e) => e.wall === "east")!;
  s = await controller.updateEntrance(
    entrance.id,
    await entrancePipe.transform(
      { ...req(), name: "Переименованный вход" },
      { type: "body" },
    ),
  );
  assert.deepEqual(
    s.entrances.find((e) => e.id === entrance.id),
    { ...entrance, name: "Переименованный вход" },
  );
});

test("archived footprints do not prevent shrink but restoration validates current room bounds", async () => {
  await warehouse.updateWarehousePlan({ ...req(), width: 120 });
  let s = await warehouse.createLocation({
    ...locationBody("RESTORE-BOUNDS"),
    x: 110,
    y: 80,
    width: 3,
    depth: 2,
  });
  const location = s.locations.find((l) => l.code === "RESTORE-BOUNDS")!;
  await warehouse.deleteLocation(location.id, req());
  await warehouse.updateWarehousePlan({ ...req(), width: 100 });
  await assert.rejects(
    warehouse.restoreLocation(location.id, req()),
    /границы/,
  );
  await warehouse.updateWarehousePlan({ ...req(), width: 120 });
  s = await warehouse.restoreLocation(location.id, req());
  assert.equal(s.locations.find((l) => l.id === location.id)!.archived, false);
  await warehouse.deleteLocation(location.id, req());
  await warehouse.updateWarehousePlan({ ...req(), width: 100 });
});

test("workspace revision increases only for committed new commands and replay keeps its original revision", async () => {
  const initial = await warehouse.snapshot();
  assert.ok(Number.isSafeInteger(initial.revision) && initial.revision >= 0);
  const original = { ...req(), name: "Проверка монотонной ревизии" };
  const first = await warehouse.updateWarehousePlan(original);
  assert.equal(first.revision, initial.revision + 1);
  const second = await warehouse.updateShift("employee-4", {
    ...req(),
    status: "off",
  });
  assert.equal(second.revision, first.revision + 1);
  const replay = await warehouse.updateWarehousePlan(original);
  assert.equal(replay.revision, first.revision);
  assert.deepEqual(replay, first);
  assert.deepEqual(await warehouse.snapshot(), second);
  await assert.rejects(
    warehouse.updateWarehousePlan({ ...req(), width: 0.5 }),
    /Размеры/,
  );
  assert.equal((await warehouse.snapshot()).revision, second.revision);
});

test("first space preserves exact legacy entrance segments and rolls back an unmatched transition", async () => {
  const before = await warehouse.snapshot();
  assert.equal(before.warehouse.layoutMode, "rectangle");
  assert.deepEqual(before.warehouse.spaces, []);
  await assert.rejects(
    warehouse.createSpace({
      ...req(),
      name: "Неполный первый участок",
      kind: "room",
      x: 0,
      y: 0,
      width: 99,
      depth: 100,
    }),
    /сохранить существующие входы/,
  );
  assert.deepEqual(await warehouse.snapshot(), before);
  const { globalDoorSegment } = await import("../src/layout");
  const originalSegments = new Map(
    before.entrances.map((e) => [e.id, globalDoorSegment(before.warehouse, e)]),
  );
  const s = await warehouse.createSpace({
    ...req(),
    name: "Основное помещение",
    kind: "room",
    x: 0,
    y: 0,
    width: 100,
    depth: 100,
  });
  const first = s.warehouse.spaces.find(
    (space) => space.name === "Основное помещение",
  )!;
  assert.match(first.id, /^[0-9a-f-]{36}$/i);
  assert.equal(s.warehouse.layoutMode, "spaces");
  for (const entrance of s.entrances) {
    assert.equal(entrance.spaceId, first.id);
    assert.deepEqual(
      globalDoorSegment(s.warehouse, entrance),
      originalSegments.get(entrance.id),
    );
  }
  assert.equal(s.revision, before.revision + 1);
  assert.deepEqual(s.pallets, before.pallets);
  assert.deepEqual(s.boxes, before.boxes);
  await assert.rejects(
    warehouse.updateWarehousePlan({ ...req(), layoutMode: "rectangle" }),
    /прямоугольном режиме/,
  );
});
test("spaces reject overlap and require each storage footprint to fit a single room or corridor", async () => {
  await warehouse.updateWarehousePlan({ ...req(), width: 150 });
  let s = await warehouse.createSpace({
    ...req(),
    name: "Второе помещение",
    kind: "room",
    x: 100,
    y: 0,
    width: 10,
    depth: 10,
  });
  const room = s.warehouse.spaces.find(
    (space) => space.name === "Второе помещение",
  )!;
  await assert.rejects(
    warehouse.createSpace({
      ...req(),
      name: "Перекрытие комнат",
      kind: "room",
      x: 99,
      y: 0,
      width: 2,
      depth: 2,
    }),
    /пересекается/,
  );
  await assert.rejects(
    warehouse.createLocation({
      ...locationBody("SPACE-BRIDGE"),
      x: 99,
      y: 5,
      width: 2,
      depth: 2,
    }),
    /целиком.*одном/,
  );
  await assert.rejects(
    warehouse.createLocation({
      ...locationBody("SPACE-GAP"),
      x: 105,
      y: 15,
      width: 2,
      depth: 2,
    }),
    /целиком.*одном/,
  );
  s = await warehouse.createLocation({
    ...locationBody("SPACE-ROOM-STORAGE"),
    x: 101,
    y: 5,
    width: 2,
    depth: 2,
  });
  assert.ok(s.locations.some((l) => l.code === "SPACE-ROOM-STORAGE"));
  s = await warehouse.createSpace({
    ...req(),
    name: "Соединительный коридор",
    kind: "corridor",
    x: 100,
    y: 20,
    width: 20,
    depth: 4,
  });
  s = await warehouse.createLocation({
    ...locationBody("SPACE-CORRIDOR-STORAGE"),
    x: 102,
    y: 21,
    width: 2,
    depth: 2,
  });
  assert.ok(s.locations.some((l) => l.code === "SPACE-CORRIDOR-STORAGE"));
  await warehouse.createAisle({
    ...req(),
    name: "Свободный проход коридора",
    x: 110,
    y: 20,
    width: 2,
    depth: 4,
  });
  await assert.rejects(
    warehouse.createLocation({
      ...locationBody("SPACE-IN-AISLE"),
      x: 110,
      y: 21,
      width: 2,
      depth: 2,
    }),
    /пересекается/,
  );
  const before = await warehouse.snapshot();
  await assert.rejects(
    warehouse.updateSpace(room.id, { ...req(), width: 2 }),
    /целиком.*одном/,
  );
  assert.deepEqual(await warehouse.snapshot(), before);
  await assert.rejects(
    warehouse.updateWarehousePlan({ ...req(), width: 115 }),
    /границы/,
  );
});
test("entrance ownership is local but physical shared-wall openings are globally unique", async () => {
  let s = await warehouse.snapshot();
  const first = s.warehouse.spaces.find(
      (space) => space.name === "Основное помещение",
    )!,
    second = s.warehouse.spaces.find(
      (space) => space.name === "Второе помещение",
    )!;
  await assert.rejects(
    warehouse.createEntrance({
      ...req(),
      name: "Без владельца",
      spaceId: null,
      wall: "north",
      offset: 0,
      width: 1,
    }),
    /должен быть привязан/,
  );
  await assert.rejects(
    warehouse.createEntrance({
      ...req(),
      name: "За стеной комнаты",
      spaceId: second.id,
      wall: "north",
      offset: 9.5,
      width: 1,
    }),
    /стены/,
  );
  s = await warehouse.createEntrance({
    ...req(),
    name: "Общая дверь",
    spaceId: first.id,
    wall: "east",
    offset: 3,
    width: 2,
  });
  const door = s.entrances.find((e) => e.name === "Общая дверь")!;
  await assert.rejects(
    warehouse.createEntrance({
      ...req(),
      name: "Та же дверь с другой стороны",
      spaceId: second.id,
      wall: "west",
      offset: 3,
      width: 2,
    }),
    /физический проём/,
  );
  await assert.rejects(
    warehouse.createEntrance({
      ...req(),
      name: "Частичный дубль",
      spaceId: second.id,
      wall: "west",
      offset: 4,
      width: 2,
    }),
    /физический проём/,
  );
  s = await warehouse.createEntrance({
    ...req(),
    name: "Соседняя общая дверь",
    spaceId: second.id,
    wall: "west",
    offset: 5,
    width: 1,
  });
  s = await warehouse.createEntrance({
    ...req(),
    name: "Другая физическая стена",
    spaceId: second.id,
    wall: "east",
    offset: 3,
    width: 1,
  });
  const { globalDoorSegment } = await import("../src/layout");
  assert.deepEqual(globalDoorSegment(s.warehouse, door), {
    axis: "vertical",
    line: 100,
    start: 3,
    end: 5,
  });
  await assert.rejects(
    warehouse.deleteSpace(second.id, req()),
    /активные входы/,
  );
});
test("space archival preserves IDs and history and validates orphan floor, entrances, bounds and restore conflicts", async () => {
  let s = await warehouse.snapshot();
  const room = s.warehouse.spaces.find(
      (space) => space.name === "Второе помещение",
    )!,
    storage = s.locations.find((l) => l.code === "SPACE-ROOM-STORAGE")!;
  const doors = s.entrances.filter((e) => e.spaceId === room.id && !e.archived);
  for (const door of doors) await warehouse.deleteEntrance(door.id, req());
  await assert.rejects(warehouse.deleteSpace(room.id, req()), /целиком.*одном/);
  await warehouse.deleteLocation(storage.id, req());
  s = await warehouse.deleteSpace(room.id, req());
  assert.equal(
    s.warehouse.spaces.find((space) => space.id === room.id)!.archived,
    true,
  );
  await assert.rejects(
    warehouse.restoreEntrance(doors[0].id, req()),
    /Участок входа.*архив/,
  );
  s = await warehouse.createSpace({
    ...req(),
    name: "Временный участок на старом месте",
    kind: "corridor",
    x: 100,
    y: 0,
    width: 10,
    depth: 10,
  });
  const replacement = s.warehouse.spaces.find(
    (space) => space.name === "Временный участок на старом месте",
  )!;
  await assert.rejects(warehouse.restoreSpace(room.id, req()), /пересекается/);
  await warehouse.deleteSpace(replacement.id, req());
  s = await warehouse.restoreSpace(room.id, req());
  assert.equal(
    s.warehouse.spaces.find((space) => space.id === room.id)!.archivedAt,
    null,
  );
  for (const door of doors) await warehouse.restoreEntrance(door.id, req());
  s = await warehouse.restoreLocation(storage.id, req());
  assert.equal(
    s.locations.find((l) => l.id === storage.id)!.code,
    storage.code,
  );
  s = await warehouse.createSpace({
    ...req(),
    name: "Дальний пустой участок",
    kind: "room",
    x: 140,
    y: 0,
    width: 5,
    depth: 5,
  });
  const far = s.warehouse.spaces.find(
    (space) => space.name === "Дальний пустой участок",
  )!;
  await warehouse.deleteSpace(far.id, req());
  await warehouse.updateWarehousePlan({ ...req(), width: 130 });
  await assert.rejects(warehouse.restoreSpace(far.id, req()), /границы/);
  await warehouse.updateWarehousePlan({ ...req(), width: 150 });
  s = await warehouse.restoreSpace(far.id, req());
  assert.equal(
    s.warehouse.spaces.find((space) => space.id === far.id)!.id,
    far.id,
  );
});
test("space partial DTOs preserve geometry and only entrance ownership permits nullable input", async () => {
  const { ValidationPipe } = await import("@nestjs/common");
  const { WarehouseController } = await import("../src/app");
  const D = await import("../src/dto");
  const controller = new WarehouseController(warehouse);
  const spacePipe = new ValidationPipe({
    expectedType: D.UpdateSpaceDto,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  for (const field of ["name", "kind", "x", "y", "width", "depth"])
    await assert.rejects(
      spacePipe.transform({ ...req(), [field]: null }, { type: "body" }),
      (error: any) => error.getStatus?.() === 400,
    );
  const planPipe = new ValidationPipe({
    expectedType: D.UpdateWarehousePlanDto,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  await assert.rejects(
    planPipe.transform({ ...req(), layoutMode: null }, { type: "body" }),
    (error: any) => error.getStatus?.() === 400,
  );
  const s = await warehouse.snapshot(),
    space = s.warehouse.spaces.find(
      (space) => space.name === "Дальний пустой участок",
    )!;
  const body = await spacePipe.transform(
    { ...req(), name: "Дальний переименованный участок" },
    { type: "body" },
  );
  assert.equal(body.x, undefined);
  const updated = await controller.updateSpace(space.id, body);
  assert.deepEqual(
    updated.warehouse.spaces.find((item) => item.id === space.id),
    { ...space, name: "Дальний переименованный участок" },
  );
  const entrancePipe = new ValidationPipe({
    expectedType: D.UpdateEntranceDto,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const nullable = await entrancePipe.transform(
    { ...req(), spaceId: null },
    { type: "body" },
  );
  assert.equal(nullable.spaceId, null);
  await assert.rejects(
    entrancePipe.transform({ ...req(), spaceId: 123 }, { type: "body" }),
    (error: any) => error.getStatus?.() === 400,
  );
  const { checkSpace } = await import("../src/layout");
  const full = structuredClone(updated.warehouse);
  full.spaces = Array.from({ length: 101 }, (_, i) => ({
    id: `cap-${i}`,
    name: `Участок${i}`,
    kind: "room",
    x: i,
    y: 0,
    width: 0.5,
    depth: 0.5,
    archived: false,
    archivedAt: null,
  }));
  await assert.rejects(
    async () => checkSpace(full, full.spaces[0]),
    /100 активных/,
  );
});

test("small storage rectangles pass the real transformed DTO/controller boundary, rotate and restore without changing tier dimensions", async () => {
  const { ValidationPipe } = await import("@nestjs/common");
  const D = await import("../src/dto");
  const { WarehouseController } = await import("../src/app");
  const controller = new WarehouseController(warehouse);
  const transform = (dto: any, body: unknown) =>
    new ValidationPipe({
      expectedType: dto,
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }).transform(body, { type: "body" });
  const profile = {
    code: "SCALE-TIER-01",
    name: "Малый первый ярус",
    maxHeightMm: 1800,
    maxBoxes: 18,
    availableWidthMm: 1300,
    availableDepthMm: 900,
  };
  let state = await controller.createLocation(
    await transform(D.CreateLocationDto, {
      ...locationBody("SCALE-FLOOR"),
      x: 90,
      y: 90,
      width: 1.2,
      depth: 0.8,
    }),
  );
  const floor = state.locations.find((l) => l.code === "SCALE-FLOOR")!;
  assert.equal(floor.width, 1.2);
  assert.equal(floor.depth, 0.8);
  state = await controller.createRackSection(
    await transform(D.CreateRackSectionDto, {
      ...req(),
      code: "SCALE-SECTION",
      name: "Реальная малая секция",
      x: 92,
      y: 90,
      width: 1.3,
      depth: 0.9,
      levels: [profile],
    }),
  );
  const section = state.sections.find((s) => s.code === "SCALE-SECTION")!;
  assert.equal(section.width, 1.3);
  assert.equal(section.depth, 0.9);
  state = await controller.updateRackSection(
    section.id,
    await transform(D.UpdateRackSectionDto, { ...req(), rotation: 90 }),
  );
  state = await controller.createRackLevel(
    section.id,
    await transform(D.CreateRackLevelDto, {
      ...req(),
      ...profile,
      code: "SCALE-TIER-02",
      name: "Малый второй ярус",
    }),
  );
  const tiers = state.locations.filter((l) => l.sectionId === section.id);
  assert.equal(tiers.length, 2);
  assert.ok(
    tiers.every(
      (l) =>
        l.width === 1.3 &&
        l.depth === 0.9 &&
        l.rotation === 90 &&
        l.x === 92 &&
        l.y === 90 &&
        l.availableWidthMm === 1300 &&
        l.availableDepthMm === 900,
    ),
  );
  state = await controller.updateLocation(
    floor.id,
    await transform(D.UpdateLocationDto, {
      ...req(),
      width: 1.21,
      depth: 0.83,
      rotation: 270,
    }),
  );
  assert.equal(state.locations.find((l) => l.id === floor.id)!.width, 1.21);
  assert.equal(state.locations.find((l) => l.id === floor.id)!.depth, 0.83);
  const label = await warehouse.getLabel("location", tiers[0].id);
  await controller.deleteRackSection(section.id, req());
  state = await controller.restoreRackSection(section.id, req());
  assert.deepEqual(
    state.sections.find((s) => s.id === section.id),
    { ...section, rotation: 90 },
  );
  for (const tier of tiers)
    assert.deepEqual(
      state.locations.find((l) => l.id === tier.id),
      tier,
    );
  assert.equal(
    (await warehouse.getLabel("location", tiers[0].id)).payload,
    label.payload,
  );
  state = await controller.updateWarehousePlan(
    await transform(D.UpdateWarehousePlanDto, {
      ...req(),
      name: state.warehouse.name,
    }),
  );
  assert.equal(state.sections.find((s) => s.id === section.id)!.depth, 0.9);
  const mainSpace = state.warehouse.spaces.find(
    (space) => space.name === "Основное помещение",
  )!;
  await controller.updateSpace(
    mainSpace.id,
    await transform(D.UpdateSpaceDto, { ...req(), name: mainSpace.name }),
  );
  state = await controller.createLocation(
    await transform(D.CreateLocationDto, {
      ...locationBody("SCALE-MIN"),
      x: 94,
      y: 90,
      width: 0.1,
      depth: 0.1,
    }),
  );
  assert.equal(state.locations.find((l) => l.code === "SCALE-MIN")!.width, 0.1);
});
test("storage DTOs reject dimensions below 0.1, null and non-finite values without lowering other domain minimums", async () => {
  const { ValidationPipe } = await import("@nestjs/common");
  const D = await import("../src/dto");
  const transform = (dto: any, body: unknown) =>
    new ValidationPipe({
      expectedType: dto,
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }).transform(body, { type: "body" });
  const location = {
    ...locationBody("SCALE-INVALID"),
    x: 95,
    y: 90,
    width: 1.3,
    depth: 0.9,
  };
  const rack = {
    ...req(),
    code: "SCALE-INVALID-RACK",
    name: "Проверка ограничений",
    x: 95,
    y: 90,
    width: 1.3,
    depth: 0.9,
    levels: [
      {
        code: "SCALE-INVALID-TIER",
        name: "Ярус",
        maxHeightMm: 1800,
        maxBoxes: 18,
        availableWidthMm: 1300,
        availableDepthMm: 900,
      },
    ],
  };
  for (const [dto, valid] of [
    [D.CreateLocationDto, location],
    [D.UpdateLocationDto, { ...req(), width: 1.3, depth: 0.9 }],
    [D.CreateRackSectionDto, rack],
    [D.UpdateRackSectionDto, { ...req(), width: 1.3, depth: 0.9 }],
  ] as const)
    for (const field of ["width", "depth"])
      for (const value of [0.099, 0, -1, null, NaN, Infinity])
        await assert.rejects(
          transform(dto, { ...valid, [field]: value }),
          (error: any) => error.getStatus?.() === 400,
          `${dto.name}.${field}=${String(value)}`,
        );
  await assert.rejects(
    transform(D.CreateAisleDto, {
      ...req(),
      name: "Проход",
      x: 0,
      y: 0,
      width: 0.49,
      depth: 2,
    }),
  );
  await assert.rejects(
    transform(D.CreateSpaceDto, {
      ...req(),
      name: "Помещение",
      kind: "room",
      x: 0,
      y: 0,
      width: 0.49,
      depth: 2,
    }),
  );
  await assert.rejects(
    transform(D.UpdateWarehousePlanDto, { ...req(), width: 0.9 }),
  );
  await assert.rejects(
    transform(D.CreateLocationDto, { ...location, availableWidthMm: 99 }),
  );
  await assert.rejects(
    transform(D.CreateTaskDto, {
      ...req(),
      skuId: "sku-cats",
      boxesTarget: 0.5,
    }),
  );
  const { checkRect, checkSpace } = await import("../src/layout");
  const state = await warehouse.snapshot();
  await assert.rejects(
    async () =>
      checkRect(
        state,
        {
          id: "invalid-small-aisle",
          name: "Проход",
          x: 0,
          y: 0,
          width: 0.49,
          depth: 2,
          rotation: 0,
        },
        "aisle",
      ),
    /геометрия/,
  );
  await assert.rejects(
    async () =>
      checkSpace(state.warehouse, {
        id: "invalid-small-room",
        name: "Помещение",
        kind: "room",
        x: 0,
        y: 0,
        width: 0.49,
        depth: 2,
        archived: false,
        archivedAt: null,
      }),
    /геометрия/,
  );
});

const receivedPallet = (s: WorkspaceDto, receiptId: string, index = 0) => {
  const pallet = s.pallets.find(
    (p) =>
      p.id ===
      s.receipts.find((r) => r.id === receiptId)!.pallets[index].palletId,
  )!;
  assert.equal(pallet.kind, "raw");
  assert.ok(pallet.skuId);
  return pallet as import("../src/dto").PalletDto & { skuId: string };
};
async function receiptCell(code: string, x: number, extra = {}) {
  const s = await warehouse.createLocation({
    ...locationBody(code),
    x,
    y: 55,
    ...extra,
  });
  return s.locations.find((l) => l.code === code)!;
}
async function newReceipt(
  rows: import("../src/dto").CreateReceiptPalletDto[],
  receivedAt = "2026-10-01T09:00:00.000Z",
) {
  const before = await warehouse.snapshot();
  const state = await warehouse.createReceipt({
    ...req(),
    receivedAt,
    pallets: rows,
  });
  return {
    state,
    receipt: state.receipts.find(
      (r) => !before.receipts.some((old) => old.id === r.id),
    )!,
  };
}
function placeBody(
  p: import("../src/dto").PalletDto,
  l: import("../src/dto").LocationDto,
  extra = {},
) {
  return {
    ...req(),
    employeeId: "employee-1",
    palletCode: p.code,
    locationCode: l.code,
    ...extra,
  };
}
test("receiving pending docs add zero on-hand, do not occupy storage or allow stock operations, and options are read-only", async () => {
  const l = await receiptCell("RCV-PENDING", 35);
  const before = await warehouse.snapshot();
  const { state: s, receipt } = await newReceipt([
    { skuId: "sku-cats", quantity: 77 },
  ]);
  const p = receivedPallet(s, receipt.id);
  assert.equal(p.status, "awaiting_placement");
  assert.equal(p.locationId, null);
  assert.equal(p.returnLocationId, null);
  assert.equal(s.balance.totalUnits, before.balance.totalUnits);
  assert.equal(
    s.balance.awaitingPlacementUnits,
    before.balance.awaitingPlacementUnits + 77,
  );
  assert.equal(
    s.balance.awaitingPlacementPallets,
    before.balance.awaitingPlacementPallets + 1,
  );
  const prior = await warehouse.snapshot();
  const options = await warehouse.getReceiptPlacementOptions(receipt.id, p.id);
  assert.ok(options.locations.some((x) => x.id === l.id));
  assert.ok(options.locations.every((x) => ["floor", "rack"].includes(x.kind)));
  assert.deepEqual(await warehouse.snapshot(), prior);
  const taskState = await warehouse.createTask({
    ...req(),
    skuId: "sku-cats",
    boxesTarget: 1,
  });
  assert.ok(
    taskState.tasks.every((t) =>
      t.reservations.every((r) => r.palletId !== p.id),
    ),
  );
  await assert.rejects(
    warehouse.createMovement({
      ...req(),
      palletId: p.id,
      toLocationId: l.id,
      kind: "transfer",
      employeeId: "employee-1",
    }),
    /хран|адрес/,
  );
  await assert.rejects(
    warehouse.retireEmptyPallet(p.id, placeBody(p, l)),
    /пуст|хран|остат|известном адресе/,
  );
  // A pending pallet creates no physical reservation and cannot stop address archival.
  await warehouse.deleteLocation(l.id, req());
});
test("partial placement requires both real scans and working staff, replay admits once and completion preserves actual FIFO date", async () => {
  const l1 = await receiptCell("RCV-PARTIAL-1", 40),
    l2 = await receiptCell("RCV-PARTIAL-2", 45);
  const prior = await warehouse.snapshot();
  const body = {
    ...req(),
    receivedAt: "2026-09-01T08:30:00+03:00",
    pallets: [
      {
        newSku: { name: "Приёмка FIFO", barcode: "RECEIPT-FIFO" },
        quantity: 10,
      },
      {
        newSku: { name: "Приёмка FIFO", barcode: "RECEIPT-FIFO" },
        quantity: 10,
      },
    ],
  };
  const s = await warehouse.createReceipt(body),
    receipt = s.receipts.find(
      (r) => !prior.receipts.some((old) => old.id === r.id),
    )!;
  assert.deepEqual(await warehouse.createReceipt(body), s);
  assert.equal((await warehouse.snapshot()).revision, s.revision);
  const p1 = receivedPallet(s, receipt.id),
    p2 = receivedPallet(s, receipt.id, 1);
  assert.equal(p1.skuId, p2.skuId);
  const pending = await warehouse.snapshot();
  await assert.rejects(
    warehouse.placeReceiptPallet(
      receipt.id,
      p1.id,
      placeBody(p1, l1, { palletCode: p2.code }),
    ),
    /Неверный/,
  );
  await assert.rejects(
    warehouse.placeReceiptPallet(
      receipt.id,
      p1.id,
      placeBody(p1, l1, { locationCode: "wrong" }),
    ),
    /Скан/,
  );
  await assert.rejects(
    warehouse.placeReceiptPallet(
      receipt.id,
      p1.id,
      placeBody(p1, l1, { employeeId: "employee-4" }),
    ),
    /смене/,
  );
  assert.deepEqual(await warehouse.snapshot(), pending);
  const cmd = placeBody(p1, l1, {
    palletCode: `artmate-wms:pallet:${p1.id}`,
    locationCode: `artmate-wms:location:${l1.id}`,
  });
  let placed = await warehouse.placeReceiptPallet(receipt.id, p1.id, cmd);
  assert.equal(
    placed.receipts.find((r) => r.id === receipt.id)!.status,
    "partially_placed",
  );
  assert.equal(placed.balance.totalUnits, prior.balance.totalUnits + 10);
  assert.equal(
    placed.receipts.find((r) => r.id === receipt.id)!.completedAt,
    null,
  );
  assert.deepEqual(
    await warehouse.placeReceiptPallet(receipt.id, p1.id, cmd),
    placed,
  );
  assert.equal((await warehouse.snapshot()).revision, placed.revision);
  await assert.rejects(
    warehouse.placeReceiptPallet(receipt.id, p1.id, placeBody(p1, l1)),
    /уже размещена/,
  );
  await assert.rejects(
    warehouse.getReceiptPlacementOptions(receipt.id, p1.id),
    /уже размещена/,
  );
  placed = await warehouse.placeReceiptPallet(
    receipt.id,
    p2.id,
    placeBody(p2, l2),
  );
  const completed = placed.receipts.find((r) => r.id === receipt.id)!;
  assert.equal(completed.status, "completed");
  assert.ok(completed.completedAt);
  assert.equal(placed.balance.totalUnits, prior.balance.totalUnits + 20);
  for (const p of [p1, p2])
    assert.equal(
      placed.lots.find((l) => l.id === p.lotId)!.receivedAt,
      "2026-09-01T05:30:00.000Z",
    );
  const taskState = await warehouse.createTask({
    ...req(),
    skuId: p1.skuId,
    boxesTarget: 1,
  });
  const task = taskState.tasks.find((t) => t.skuId === p1.skuId)!;
  assert.equal(
    task.reservations.reduce((sum, r) => sum + r.quantity, 0),
    20,
  );
  assert.ok(
    task.reservations.every((r) => [p1.id, p2.id].includes(r.palletId)),
  );
});
test("receipt rows retain original quantity and placement history after movement, consumption and reprinting", async () => {
  const source = await receiptCell("RCV-HISTORY-SOURCE", 50),
    target = await receiptCell("RCV-HISTORY-TARGET", 55);
  const { state, receipt } = await newReceipt([
    {
      newSku: {
        name: "История приёмки",
        barcode: "RECEIPT-HISTORY",
        unitsPerBox: 2,
      },
      quantity: 5,
    },
  ]);
  const p = receivedPallet(state, receipt.id);
  const labels = await warehouse.getReceiptLabels(receipt.id);
  assert.match(labels.labels[0].svg, /<svg/);
  assert.equal(
    labels.labels[0].payload,
    (await warehouse.getLabel("pallet", p.id)).payload,
  );
  let s = await warehouse.placeReceiptPallet(
    receipt.id,
    p.id,
    placeBody(p, source),
  );
  const row = structuredClone(
    s.receipts.find((r) => r.id === receipt.id)!.pallets[0],
  );
  s = await warehouse.createMovement({
    ...req(),
    palletId: p.id,
    toLocationId: target.id,
    kind: "transfer",
    employeeId: "employee-1",
  });
  const m = s.movements.find((m) => m.palletId === p.id)!;
  await warehouse.takeMovement(m.id, placeBody(p, source));
  assert.equal(
    (await warehouse.snapshot()).balance.rawUnits,
    s.balance.rawUnits,
  );
  s = await warehouse.placeMovement(m.id, placeBody(p, target));
  s = await warehouse.createTask({
    ...req(),
    skuId: p.skuId,
    boxesTarget: 1,
    employeeId: "employee-3",
  });
  const t = s.tasks.find((t) => t.skuId === p.skuId)!;
  await warehouse.updateTaskStatus(t.id, {
    ...req(),
    employeeId: "employee-3",
    status: "active",
  });
  await warehouse.scanTask(t.id, {
    ...req(),
    employeeId: "employee-3",
    kind: "source",
    value: p.code,
  });
  await warehouse.scanTask(t.id, {
    ...req(),
    employeeId: "employee-3",
    kind: "box",
    value: t.openBoxCode,
  });
  s = await warehouse.scanTask(t.id, {
    ...req(),
    employeeId: "employee-3",
    kind: "barcode",
    value: "RECEIPT-HISTORY",
  });
  assert.equal(s.pallets.find((x) => x.id === p.id)!.quantity, 4);
  assert.equal(s.balance.workInProgressUnits, 1);
  assert.deepEqual(
    s.receipts.find((r) => r.id === receipt.id)!.pallets[0],
    row,
  );
  assert.deepEqual(await warehouse.getReceiptLabels(receipt.id), labels);
  assert.equal(labels.labels[0].quantity, 5);
  await warehouse.updateTaskStatus(t.id, {
    ...req(),
    employeeId: "employee-3",
    status: "paused",
  });
});
test("receipt creation and inline SKU dedup are atomic including last-row conflict, strict future dates and code collisions", async () => {
  const before = await warehouse.snapshot();
  await assert.rejects(
    warehouse.createReceipt({
      ...req(),
      receivedAt: "2999-01-01T00:00:00.000Z",
      pallets: [{ skuId: "sku-cats", quantity: 1 }],
    }),
    /Дата/,
  );
  await assert.rejects(
    warehouse.createReceipt({
      ...req(),
      receivedAt: "2026-10-01T00:00:00Z",
      pallets: [
        {
          newSku: { name: "Atomic new", barcode: "ATOMIC-ROLLBACK" },
          quantity: 1,
        },
        { skuId: "missing", quantity: 1 },
      ],
    }),
    /не найден/,
  );
  await assert.rejects(
    warehouse.createReceipt({
      ...req(),
      receivedAt: "2026-10-01T00:00:00Z",
      pallets: [
        {
          newSku: { name: "Atomic new", barcode: "ATOMIC-ROLLBACK" },
          quantity: 1,
        },
        {
          newSku: { name: "Conflicting", barcode: before.skus[0].barcode },
          quantity: 1,
        },
      ],
    }),
    /Выберите существующую/,
  );
  assert.deepEqual(await warehouse.snapshot(), before);
  const sku = before.skus[0];
  const { state } = await newReceipt([
    {
      newSku: {
        name: sku.name,
        barcode: sku.barcode,
        code: sku.code,
        unitsPerBox: sku.unitsPerBox,
      },
      quantity: 1,
    },
  ]);
  assert.equal(state.skus.length, before.skus.length);
  await assert.rejects(
    newReceipt([
      {
        newSku: {
          name: "New code conflict",
          barcode: "NEW-CODE-FAIL",
          code: sku.code.toLowerCase(),
        },
        quantity: 1,
      },
    ]),
    /Код тематики/,
  );
});
test("receiving DTO/controller rejects invalid XOR, null, nested unknowns, numeric/date errors and trims SKU fields", async () => {
  const { ValidationPipe } = await import("@nestjs/common");
  const D = await import("../src/dto");
  const { WarehouseController } = await import("../src/app");
  const controller = new WarehouseController(warehouse);
  const transform = (dto: any, body: unknown) =>
    new ValidationPipe({
      expectedType: dto,
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }).transform(body, { type: "body" });
  const body = () => ({
    ...req(),
    receivedAt: "2026-10-01T00:00:00Z",
    pallets: [{ skuId: "sku-cats", quantity: 1 }],
  });
  for (const row of [
    { quantity: 1 },
    { skuId: "sku-cats", newSku: { name: "X", barcode: "X" }, quantity: 1 },
    { skuId: null, quantity: 1 },
    { skuId: "sku-cats", quantity: null },
    { skuId: "sku-cats", quantity: 1.2 },
    { skuId: "sku-cats", quantity: 1, widthMm: null },
    { skuId: "sku-cats", quantity: 1, heightMm: NaN },
    { newSku: { name: "  ", barcode: "x" }, quantity: 1 },
    { newSku: { name: "X", barcode: "X", unknown: true }, quantity: 1 },
    { skuId: "sku-cats", quantity: 1, locationId: "loc-1" },
  ]) {
    await assert.rejects(
      transform(D.CreateReceiptDto, { ...body(), pallets: [row] }),
      (e: any) => e.getStatus() === 400,
    );
  }
  for (const changes of [
    { receivedAt: null },
    { receivedAt: "2026-02-30T00:00:00Z" },
    { receivedAt: "2026-10-01" },
    { pallets: null },
    { pallets: [] },
    {
      pallets: Array.from({ length: 101 }, () => ({
        skuId: "sku-cats",
        quantity: 1,
      })),
    },
    { locationId: "loc-1" },
  ])
    await assert.rejects(
      transform(D.CreateReceiptDto, { ...body(), ...changes }),
    );
  const s = await controller.createReceipt(
    await transform(D.CreateReceiptDto, {
      ...body(),
      pallets: [
        {
          newSku: { name: "  Новая тема  ", barcode: "  TRIMMED-BARCODE  " },
          quantity: 1,
          weightKg: null,
        },
      ],
    }),
  );
  assert.ok(
    s.skus.some(
      (s) => s.name === "Новая тема" && s.barcode === "TRIMMED-BARCODE",
    ),
  );
  for (const field of ["employeeId", "palletCode", "locationCode"])
    await assert.rejects(
      transform(D.PlaceReceiptPalletDto, {
        ...req(),
        employeeId: "x",
        palletCode: "x",
        locationCode: "x",
        [field]: null,
      }),
    );
});
test("employee creation works without demo defaults, starts off, rejects duplicate and invalid DTO", async () => {
  const { ValidationPipe } = await import("@nestjs/common");
  const { CreateEmployeeDto } = await import("../src/dto");
  const pipe = new ValidationPipe({
    expectedType: CreateEmployeeDto,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const body = await pipe.transform(
    { ...req(), name: "  Анна Лебедева  " },
    { type: "body" },
  );
  let s = await warehouse.createEmployee(body),
    e = s.employees.find((e) => e.name === "Анна Лебедева")!;
  assert.equal(e.status, "off");
  assert.equal(e.initials, "АЛ");
  assert.equal(e.boxesToday, 0);
  assert.equal(e.unitsToday, 0);
  await assert.rejects(
    warehouse.createEmployee({ ...req(), name: "анна лебедева" }),
    /уже существует/,
  );
  for (const changes of [
    { name: null },
    { name: " " },
    { role: null },
    { role: " " },
    { unknown: 1 },
  ])
    await assert.rejects(
      pipe.transform({ ...req(), name: "Test", ...changes }, { type: "body" }),
    );
  s = await warehouse.updateShift(e.id, { ...req(), status: "working" });
  assert.equal(s.employees.find((x) => x.id === e.id)!.status, "working");
});
test("two receipt placements racing for one address produce exactly one balance admission", async () => {
  const l = await receiptCell("RCV-RACE", 65);
  const before = await warehouse.snapshot();
  const { state, receipt } = await newReceipt([
    { skuId: "sku-cats", quantity: 8 },
    { skuId: "sku-cats", quantity: 8 },
  ]);
  const p1 = receivedPallet(state, receipt.id),
    p2 = receivedPallet(state, receipt.id, 1);
  const other = process.env.WMS_TEST_DATABASE_URL
    ? new WarehouseService()
    : warehouse;
  try {
    const results = await Promise.allSettled([
      warehouse.placeReceiptPallet(receipt.id, p1.id, placeBody(p1, l)),
      other.placeReceiptPallet(receipt.id, p2.id, placeBody(p2, l)),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    const saved = await warehouse.snapshot();
    assert.equal(saved.balance.totalUnits, before.balance.totalUnits + 8);
    assert.equal(saved.pallets.filter((p) => p.locationId === l.id).length, 1);
    assert.equal(
      saved.receipts.find((r) => r.id === receipt.id)!.status,
      "partially_placed",
    );
    assert.deepEqual(await other.snapshot(), saved);
  } finally {
    if (other !== warehouse) await other.onModuleDestroy();
  }
});
test("receipt actual dates drive FIFO after reverse placement order and mixed-lot packing conserves balance", async () => {
  const olderCell = await receiptCell("RCV-FIFO-OLDER", 70),
    newerCell = await receiptCell("RCV-FIFO-NEWER", 75);
  await receiptCell("RCV-FIFO-ASSEMBLY", 80, { kind: "assembly" });
  const newer = await newReceipt(
    [
      {
        newSku: { name: "FIFO по приёмке", barcode: "RECEIPT-FIFO-DATES" },
        quantity: 10,
      },
    ],
    "2026-10-03T00:00:00Z",
  );
  const older = await newReceipt(
    [{ skuId: newer.receipt.pallets[0].skuId, quantity: 10 }],
    "2026-10-02T00:00:00Z",
  );
  const np = receivedPallet(newer.state, newer.receipt.id),
    op = receivedPallet(older.state, older.receipt.id);
  await warehouse.placeReceiptPallet(
    newer.receipt.id,
    np.id,
    placeBody(np, newerCell),
  );
  let s = await warehouse.placeReceiptPallet(
    older.receipt.id,
    op.id,
    placeBody(op, olderCell),
  );
  const total = s.balance.totalUnits;
  s = await warehouse.createEmployee({ ...req(), name: "Сборщик Партий" });
  const employee = s.employees.find((e) => e.name === "Сборщик Партий")!;
  await warehouse.updateShift(employee.id, { ...req(), status: "working" });
  s = await warehouse.createTask({
    ...req(),
    skuId: op.skuId,
    boxesTarget: 1,
    employeeId: employee.id,
  });
  const task = s.tasks.find((t) => t.skuId === op.skuId)!;
  assert.deepEqual(
    task.reservations.map((r) => [r.palletId, r.quantity]),
    [
      [op.id, 10],
      [np.id, 10],
    ],
  );
  await warehouse.updateTaskStatus(task.id, {
    ...req(),
    employeeId: employee.id,
    status: "active",
  });
  for (const p of [op, np]) {
    await warehouse.scanTask(task.id, {
      ...req(),
      employeeId: employee.id,
      kind: "source",
      value: p.code,
    });
    if (p.id === op.id)
      await warehouse.scanTask(task.id, {
        ...req(),
        employeeId: employee.id,
        kind: "box",
        value: task.openBoxCode,
      });
    for (let i = 0; i < 10; i++)
      s = await warehouse.scanTask(task.id, {
        ...req(),
        employeeId: employee.id,
        kind: "barcode",
        value: "RECEIPT-FIFO-DATES",
      });
  }
  assert.equal(s.balance.totalUnits, total);
  const box = s.boxes.find((b) => b.code === task.openBoxCode)!;
  assert.deepEqual(box.lotContents, [
    { lotId: op.lotId, quantity: 10 },
    { lotId: np.lotId, quantity: 10 },
  ]);
  assert.equal(s.balance.totalUnits, total);
  assert.equal(
    s.receipts.find((r) => r.id === older.receipt.id)!.pallets[0].quantity,
    10,
  );
  assert.equal(
    s.receipts.find((r) => r.id === newer.receipt.id)!.pallets[0].quantity,
    10,
  );
});

let assemblyPosition = 0;
async function assemblyLocation(code: string, kind = "floor", extra = {}) {
  const s = await warehouse.createLocation({
    ...locationBody(code, kind),
    x: 3 + assemblyPosition++ * 3,
    y: 65,
    ...extra,
  });
  return s.locations.find((l) => l.code === code)!;
}
async function assemblyActor(name: string) {
  let s = await warehouse.createEmployee({ ...req(), name });
  const actor = s.employees.find((e) => e.name === name)!;
  s = await warehouse.updateShift(actor.id, { ...req(), status: "working" });
  return actor;
}
async function assemblyStock(tag: string, unitsPerBox = 2, quantity = 30) {
  const cell = await assemblyLocation(`${tag}-RAW`);
  const { state, receipt } = await newReceipt([
    { newSku: { name: tag, barcode: tag, unitsPerBox }, quantity },
  ]);
  const p = receivedPallet(state, receipt.id);
  await warehouse.placeReceiptPallet(receipt.id, p.id, placeBody(p, cell));
  // These legacy scenarios deliberately alter wooden bases and box geometry.
  // Keep their explicit old fixture profile; new-SKU defaults are tested separately.
  await warehouse.updateSkuPackaging(p.skuId!, {
    ...req(),
    packaging: { ...DEMO_PACKAGING },
  });
  return { p, cell, skuId: p.skuId };
}
async function assemblyTask(
  skuId: string,
  boxesTarget = 1,
  employeeId?: string,
) {
  const before = await warehouse.snapshot();
  const s = await warehouse.createTask({
    ...req(),
    skuId,
    boxesTarget,
    ...(employeeId ? { employeeId } : {}),
  });
  return s.tasks.find((t) => !before.tasks.some((old) => old.id === t.id))!;
}
async function parkFreeQueue() {
  for (const t of (await warehouse.snapshot()).tasks.filter(
    (t) =>
      t.status === "queued" &&
      !t.employeeId &&
      t.scannedUnits === 0 &&
      !t.boxCodeConfirmed,
  ))
    await warehouse.assignTask(t.id, { ...req(), employeeId: "employee-4" });
}
const actorScan = (
  t: import("../src/dto").TaskDto,
  employeeId: string,
  kind: "source" | "box" | "barcode",
  value: string,
) => warehouse.scanTask(t.id, { ...req(), employeeId, kind, value });

test("claim is atomic, requires working actor, respects assignments and never bypasses ownership via legacy start", async () => {
  await parkFreeQueue();
  const stock = await assemblyStock("CLAIM-RACE"),
    a = await assemblyActor("Исполнитель Захвата"),
    b = await assemblyActor("Второй Исполнитель Захвата");
  const t = await assemblyTask(stock.skuId);
  assert.ok(t.createdAt);
  assert.equal(t.boxCodeConfirmed, false);
  await assert.rejects(
    warehouse.claimTask(t.id, { ...req(), employeeId: "employee-4" }),
    /смене/,
  );
  const other = process.env.WMS_TEST_DATABASE_URL
    ? new WarehouseService()
    : warehouse;
  try {
    const results = await Promise.allSettled([
      warehouse.claimTask(t.id, { ...req(), employeeId: a.id }),
      other.claimTask(t.id, { ...req(), employeeId: b.id }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  } finally {
    if (other !== warehouse) await other.onModuleDestroy();
  }
  const active = (await warehouse.snapshot()).tasks.find((x) => x.id === t.id)!;
  const owner = active.employeeId!,
    wrong = owner === a.id ? b.id : a.id;
  const before = await warehouse.snapshot();
  await assert.rejects(
    warehouse.updateTaskStatus(t.id, {
      ...req(),
      status: "active",
      employeeId: wrong,
    }),
    /Взять|другому/,
  );
  await assert.rejects(
    actorScan(t, wrong, "source", stock.p.code),
    /другой сотрудник/,
  );
  await assert.rejects(
    warehouse.updateTaskStatus(t.id, {
      ...req(),
      status: "paused",
      employeeId: wrong,
    }),
    /другой сотрудник/,
  );
  await assert.rejects(
    warehouse.packTask(t.id, {
      ...req(),
      employeeId: wrong,
      boxCode: t.openBoxCode,
    }),
    /другой сотрудник/,
  );
  assert.deepEqual(await warehouse.snapshot(), before);
  const t2 = await assemblyTask(stock.skuId, 1, owner);
  await assert.rejects(
    warehouse.claimTask(t2.id, { ...req(), employeeId: owner }),
    /активное задание/,
  );
  await warehouse.updateTaskStatus(t.id, {
    ...req(),
    status: "paused",
    employeeId: owner,
  });
  const body = { ...req(), employeeId: owner };
  const claimed = await warehouse.claimTask(t.id, body);
  assert.deepEqual(await warehouse.claimTask(t.id, body), claimed);
  assert.equal((await warehouse.snapshot()).revision, claimed.revision);
  await warehouse.updateShift(owner, { ...req(), status: "off" });
  assert.equal(
    (await warehouse.snapshot()).tasks.find((x) => x.id === t.id)!.status,
    "paused",
  );
  await assert.rejects(actorScan(t, owner, "source", stock.p.code), /смене/);
});

test("assignment preserves reservations and QR, permits off-shift planning, and protects a confirmed or partial box", async () => {
  const stock = await assemblyStock("ASSIGNMENT"),
    a = await assemblyActor("Исполнитель Назначения"),
    b = await assemblyActor("Другой Исполнитель Назначения");
  const t = await assemblyTask(stock.skuId);
  let s = await warehouse.assignTask(t.id, {
    ...req(),
    employeeId: "employee-4",
  });
  assert.equal(s.tasks.find((x) => x.id === t.id)!.employeeId, "employee-4");
  await assert.rejects(
    warehouse.claimTask(t.id, { ...req(), employeeId: a.id }),
    /другому сотруднику/,
  );
  await warehouse.assignTask(t.id, { ...req(), employeeId: a.id });
  await warehouse.claimTask(t.id, { ...req(), employeeId: a.id });
  await assert.rejects(
    warehouse.assignTask(t.id, { ...req(), employeeId: a.id }),
    /после паузы/,
  );
  await actorScan(t, a.id, "source", stock.p.code);
  await warehouse.updateTaskStatus(t.id, {
    ...req(),
    status: "paused",
    employeeId: a.id,
  });
  s = await warehouse.assignTask(t.id, { ...req(), employeeId: b.id });
  const next = s.tasks.find((x) => x.id === t.id)!;
  assert.equal(next.sourcePalletId, null);
  assert.equal(next.boxCodeConfirmed, false);
  assert.deepEqual(next.reservations, t.reservations);
  assert.equal(next.openBoxCode, t.openBoxCode);
  await warehouse.claimTask(t.id, { ...req(), employeeId: b.id });
  await actorScan(t, b.id, "source", stock.p.code);
  await actorScan(t, b.id, "box", t.openBoxCode);
  await warehouse.updateTaskStatus(t.id, {
    ...req(),
    status: "paused",
    employeeId: b.id,
  });
  await assert.rejects(
    warehouse.assignTask(t.id, { ...req(), employeeId: null }),
    /Закончите текущий короб/,
  );
  await warehouse.claimTask(t.id, { ...req(), employeeId: b.id });
  await actorScan(t, b.id, "barcode", "ASSIGNMENT");
  await warehouse.updateTaskStatus(t.id, {
    ...req(),
    status: "paused",
    employeeId: b.id,
  });
  await assert.rejects(
    warehouse.assignTask(t.id, { ...req(), employeeId: a.id }),
    /Закончите текущий короб/,
  );
  const unassign = await assemblyTask(stock.skuId, 1, a.id);
  s = await warehouse.assignTask(unassign.id, { ...req(), employeeId: null });
  assert.equal(s.tasks.find((x) => x.id === unassign.id)!.status, "queued");
  assert.equal(s.tasks.find((x) => x.id === unassign.id)!.employeeId, null);
});

test("new box admission rolls back on the one full mixed accumulator and completed scans replay safely", async () => {
  await parkFreeQueue();
  const { p, skuId } = await assemblyStock("AUTO-PACK-CAPACITY"),
    actor = await assemblyActor("Исполнитель Вместимости");
  let state = await warehouse.snapshot();
  const accumulator = state.pallets.find(
    (p) => p.kind === "assembly" && p.status === "stored",
  )!;
  const location = state.locations.find(
    (l) => l.id === accumulator.locationId,
  )!;
  // Earlier scenarios retain paused WIP: its promised slots remain occupied.
  const occupied =
    accumulator.quantity + assemblyPressure(state).committedBoxes;
  await warehouse.updateLocation(location.id, {
    ...req(),
    maxBoxes: occupied + 1,
  });
  const t = await assemblyTask(skuId, 1, actor.id);
  const second = await assemblyTask(skuId, 1, actor.id);
  await warehouse.claimTask(t.id, { ...req(), employeeId: actor.id });
  await assert.rejects(
    actorScan(t, actor.id, "box", t.openBoxCode),
    /исходную паллету/,
  );
  await actorScan(t, actor.id, "source", p.code);
  await assert.rejects(
    actorScan(t, actor.id, "barcode", "AUTO-PACK-CAPACITY"),
    /короба/,
  );
  await assert.rejects(
    actorScan(t, actor.id, "box", "WRONG"),
    /текущего короба/,
  );
  await actorScan(t, actor.id, "box", t.openBoxCode);
  await actorScan(t, actor.id, "box", `artmate-wms:box:${t.openBoxCode}`);
  await actorScan(t, actor.id, "barcode", "AUTO-PACK-CAPACITY");
  const firstLabel = await warehouse.getLabel("box", t.openBoxCode);
  state = await actorScan(t, actor.id, "barcode", "AUTO-PACK-CAPACITY");
  assert.deepEqual(await warehouse.getLabel("box", t.openBoxCode), firstLabel);
  const current = state.tasks.find((x) => x.id === t.id)!;
  assert.equal(current.sourcePalletId, null);
  assert.equal(current.boxCodeConfirmed, false);
  const prior = await warehouse.snapshot();
  const admission = {
    ...req(),
    employeeId: actor.id,
    kind: "box" as const,
    value: second.openBoxCode,
  };
  const claim = () =>
    warehouse.claimTask(second.id, { ...req(), employeeId: actor.id });
  await assert.rejects(claim(), /вместимость|заполнена/);
  assert.deepEqual(await warehouse.snapshot(), prior);
  // A second free address cannot create a parallel accumulator to bypass admission.
  await assemblyLocation("UNUSED-PARALLEL-ASSEMBLY", "assembly");
  const beforeSecondAttempt = await warehouse.snapshot();
  await assert.rejects(claim(), /вместимость|заполнена/);
  assert.deepEqual(await warehouse.snapshot(), beforeSecondAttempt);
  await warehouse.updateLocation(location.id, {
    ...req(),
    maxBoxes: occupied + 2,
  });
  await claim();
  await assert.rejects(
    warehouse.scanTask(second.id, admission),
    /исходную паллету/,
  );
  await actorScan(second, actor.id, "source", p.code);
  await assert.rejects(
    actorScan(second, actor.id, "box", t.openBoxCode),
    /текущего короба/,
  );
  await warehouse.scanTask(second.id, admission);
  await actorScan(second, actor.id, "barcode", "AUTO-PACK-CAPACITY");
  const final = {
    ...req(),
    employeeId: actor.id,
    kind: "barcode" as const,
    value: "AUTO-PACK-CAPACITY",
  };
  state = await warehouse.scanTask(second.id, final);
  assert.equal(state.balance.totalUnits, prior.balance.totalUnits);
  assert.equal(
    state.pallets.filter((p) => p.kind === "assembly" && p.status === "stored")
      .length,
    1,
  );
  assert.equal(
    state.boxes.find((b) => b.code === second.openBoxCode)!.palletId,
    accumulator.id,
  );
  assert.equal(state.tasks.find((x) => x.id === t.id)!.status, "completed");
  const persisted = await warehouse.snapshot();
  assert.deepEqual(await warehouse.scanTask(second.id, final), state);
  assert.deepEqual(await warehouse.snapshot(), persisted);
  await warehouse.updateLocation(location.id, {
    ...req(),
    maxBoxes: location.maxBoxes,
  });
});
test("completion and replay never start queued work, which can be claimed explicitly", async () => {
  await parkFreeQueue();
  const actor = await assemblyActor("Исполнитель Очереди"),
    stock = await assemblyStock("AUTO-QUEUE", 1, 20),
    blocked = await assemblyStock("AUTO-QUEUE-BLOCKED", 1, 10);
  const current = await assemblyTask(stock.skuId, 1, actor.id);
  const free = await assemblyTask(stock.skuId);
  const own = await assemblyTask(stock.skuId, 1, actor.id);
  const unavailable = await assemblyTask(blocked.skuId, 1, actor.id);
  const foreign = await assemblyTask(stock.skuId, 1, "employee-4");
  const paused = await assemblyTask(stock.skuId, 1, actor.id);
  await warehouse.claimTask(paused.id, { ...req(), employeeId: actor.id });
  await warehouse.updateTaskStatus(paused.id, {
    ...req(),
    status: "paused",
    employeeId: actor.id,
  });
  await assemblyLocation("AUTO-QUEUE-ASSEMBLY", "assembly");
  // This future planned task is intentionally paused to prove it is not automatically resumed.
  await warehouse.claimTask(unavailable.id, { ...req(), employeeId: actor.id });
  await warehouse.updateTaskStatus(unavailable.id, {
    ...req(),
    status: "paused",
    employeeId: actor.id,
  });
  const finish = async (t: import("../src/dto").TaskDto) => {
    const s = await warehouse.snapshot(),
      r = s.tasks
        .find((x) => x.id === t.id)!
        .reservations.find((r) => r.quantity > 0)!;
    const p = s.pallets.find((p) => p.id === r.palletId)!;
    await actorScan(t, actor.id, "source", p.code);
    await actorScan(t, actor.id, "box", t.openBoxCode);
    const command = {
      ...req(),
      employeeId: actor.id,
      kind: "barcode" as const,
      value: "AUTO-QUEUE",
    };
    return { state: await warehouse.scanTask(t.id, command), command };
  };
  await warehouse.claimTask(current.id, { ...req(), employeeId: actor.id });
  const first = await finish(current);
  assert.equal(
    first.state.tasks.find((x) => x.id === own.id)!.status,
    "queued",
  );
  assert.equal(
    first.state.tasks.find((x) => x.id === free.id)!.status,
    "queued",
  );
  const beforeReplay = await warehouse.snapshot();
  assert.deepEqual(
    await warehouse.scanTask(current.id, first.command),
    first.state,
  );
  assert.deepEqual(await warehouse.snapshot(), beforeReplay);
  await warehouse.claimTask(own.id, { ...req(), employeeId: actor.id });
  const second = await finish(own);
  assert.equal(
    second.state.tasks.find((x) => x.id === free.id)!.status,
    "queued",
  );
  assert.equal(
    second.state.tasks.find((x) => x.id === free.id)!.sourcePalletId,
    null,
  );
  assert.equal(
    second.state.tasks.find((x) => x.id === free.id)!.boxCodeConfirmed,
    false,
  );
  await warehouse.claimTask(free.id, { ...req(), employeeId: actor.id });
  const third = await finish(free);
  assert.ok(
    !third.state.tasks.some(
      (t) => t.employeeId === actor.id && t.status === "active",
    ),
  );
  assert.equal(
    third.state.tasks.find((x) => x.id === paused.id)!.status,
    "paused",
  );
  assert.equal(
    third.state.tasks.find((x) => x.id === unavailable.id)!.status,
    "paused",
  );
  assert.equal(
    third.state.tasks.find((x) => x.id === foreign.id)!.employeeId,
    "employee-4",
  );
});

test("assembly HTTP DTOs require actor and strict assignment nullability through real ValidationPipe/controller", async () => {
  const { ValidationPipe } = await import("@nestjs/common"),
    D = await import("../src/dto"),
    { WarehouseController } = await import("../src/app");
  const transform = (dto: any, body: unknown) =>
    new ValidationPipe({
      expectedType: dto,
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }).transform(body, { type: "body" });
  for (const dto of [
    D.ClaimTaskDto,
    D.ScanTaskDto,
    D.PackTaskDto,
    D.UpdateTaskStatusDto,
  ]) {
    const fields =
      dto === D.ScanTaskDto
        ? { kind: "box", value: "BOX" }
        : dto === D.PackTaskDto
          ? { boxCode: "BOX" }
          : dto === D.UpdateTaskStatusDto
            ? { status: "active" }
            : {};
    for (const employeeId of [undefined, null, "", 1])
      await assert.rejects(
        transform(dto, {
          ...req(),
          ...fields,
          ...(employeeId === undefined ? {} : { employeeId }),
        }),
      );
  }
  for (const changes of [
    {},
    { employeeId: undefined },
    { employeeId: "" },
    { employeeId: 1 },
  ])
    await assert.rejects(transform(D.AssignTaskDto, { ...req(), ...changes }));
  await transform(D.AssignTaskDto, { ...req(), employeeId: null });
  await assert.rejects(
    transform(D.ScanTaskDto, {
      ...req(),
      employeeId: "x",
      kind: "unknown",
      value: "BOX",
    }),
  );
  await assert.rejects(
    transform(D.ClaimTaskDto, { ...req(), employeeId: "x", admin: true }),
  );
  const stock = await assemblyStock("HTTP-CLAIM"),
    actor = await assemblyActor("Исполнитель HTTP"),
    t = await assemblyTask(stock.skuId);
  const controller = new WarehouseController(warehouse);
  const s = await controller.claimTask(
    t.id,
    await transform(D.ClaimTaskDto, { ...req(), employeeId: actor.id }),
  );
  assert.equal(s.tasks.find((x) => x.id === t.id)!.employeeId, actor.id);
});

async function packForPutaway(
  tag: string,
  boxesTarget = 1,
  profilePatch = { palletWidthMm: 3000, palletWeightKg: 10, boxWeightKg: 1 },
) {
  await parkFreeQueue();
  const stock = await assemblyStock(tag, 1, boxesTarget + 3),
    actor = await assemblyActor(`Сборщик ${tag}`);
  const initial = await warehouse.snapshot();
  const profile = {
    ...initial.skus.find((s) => s.id === stock.skuId)!.packaging,
    ...profilePatch,
  };
  await warehouse.updateSkuPackaging(stock.skuId, {
    ...req(),
    packaging: profile,
  });
  const tasks = [];
  const boxIds: string[] = [];
  for (let i = 0; i < boxesTarget; i++) {
    const task = await assemblyTask(stock.skuId, 1, actor.id);
    tasks.push(task);
    await warehouse.claimTask(task.id, { ...req(), employeeId: actor.id });
    await actorScan(task, actor.id, "source", stock.p.code);
    await actorScan(task, actor.id, "box", task.openBoxCode);
    const next = await actorScan(task, actor.id, "barcode", tag);
    boxIds.push(next.boxes.find((b) => b.code === task.openBoxCode)!.id);
  }
  return { ...stock, actor, task: tasks[0], boxIds };
}
const putawayOf = (s: WorkspaceDto, boxId: string) =>
  s.putawayTasks.find((t) => t.boxId === boxId && t.status !== "completed")!;
const putawayScan = (
  t: import("../src/dto").PutawayTaskDto,
  employeeId: string,
  boxCode: string,
  locationCode: string,
) => ({ ...req(), employeeId, boxCode, locationCode });

test("mixed themes share one accumulator; compatible incoming reservations share capacity while foreign SKU and overflow are rejected", async () => {
  const a = await packForPutaway("PUTAWAY-A", 3),
    b = await packForPutaway("PUTAWAY-B");
  const target = await assemblyLocation("PUTAWAY-TARGET", "floor", {
    availableWidthMm: 3200,
    maxBoxes: 2,
    maxWeightKg: 100,
  });
  const employee1 = await assemblyActor("Размещение Первый"),
    employee2 = await assemblyActor("Размещение Второй"),
    employee3 = await assemblyActor("Размещение Третий");
  let state = await warehouse.snapshot();
  const boxes = [...a.boxIds, ...b.boxIds].map(
    (id) => state.boxes.find((b) => b.id === id)!,
  );
  assert.equal(new Set(boxes.map((b) => b.palletId)).size, 1);
  const accumulator = state.pallets.find((p) => p.id === boxes[0].palletId)!;
  assert.equal(accumulator.kind, "assembly");
  assert.equal(accumulator.skuId, null);
  assert.equal(
    (await warehouse.getLabel("pallet", accumulator.id)).title,
    "Общая паллета сборки",
  );
  assert.ok(boxes.every((b) => putawayOf(state, b.id).status === "queued"));
  await assert.rejects(
    warehouse.createShipment({ ...req(), skuId: a.skuId, boxesRequested: 1 }),
    /Недостаточно/,
  );
  await assert.rejects(
    warehouse.createMovement({
      ...req(),
      palletId: accumulator.id,
      toLocationId: target.id,
      kind: "transfer",
      employeeId: employee1.id,
    }),
    /второстепенные задания/,
  );
  const t1 = putawayOf(state, a.boxIds[0]),
    t2 = putawayOf(state, a.boxIds[1]),
    t3 = putawayOf(state, a.boxIds[2]),
    foreign = putawayOf(state, b.boxIds[0]);
  const beforeOptions = await warehouse.snapshot(),
    options = await warehouse.getPutawayPlacementOptions(t1.id);
  assert.equal(options.suggestedLocationId, target.id);
  assert.deepEqual(await warehouse.snapshot(), beforeOptions);
  const other = process.env.WMS_TEST_DATABASE_URL
    ? new WarehouseService()
    : warehouse;
  try {
    const results = await Promise.allSettled([
      warehouse.claimPutawayTask(t1.id, { ...req(), employeeId: employee1.id }),
      other.claimPutawayTask(t1.id, { ...req(), employeeId: employee2.id }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  } finally {
    if (other !== warehouse) await other.onModuleDestroy();
  }
  state = await warehouse.snapshot();
  const owner = state.putawayTasks.find((t) => t.id === t1.id)!.employeeId!,
    second = owner === employee1.id ? employee2.id : employee1.id;
  state = await warehouse.claimPutawayTask(t2.id, {
    ...req(),
    employeeId: second,
  });
  assert.equal(
    state.putawayTasks.find((t) => t.id === t1.id)!.toLocationId,
    target.id,
  );
  assert.equal(
    state.putawayTasks.find((t) => t.id === t2.id)!.toLocationId,
    target.id,
  );
  const beforeOverflow = await warehouse.snapshot();
  await assert.rejects(
    warehouse.claimPutawayTask(t3.id, { ...req(), employeeId: employee3.id }),
    /Нет подходящего/,
  );
  await assert.rejects(
    warehouse.claimPutawayTask(foreign.id, {
      ...req(),
      employeeId: employee3.id,
    }),
    /Нет подходящего/,
  );
  assert.deepEqual(await warehouse.snapshot(), beforeOverflow);
  // Incoming claims protect a previously empty cell from every independent write path.
  await assert.rejects(
    warehouse.deleteLocation(target.id, req()),
    /зарезервирован/,
  );
  await assert.rejects(
    warehouse.updateLocation(target.id, { ...req(), blocked: true }),
    /зарезервирован/,
  );
  await assert.rejects(
    warehouse.updateLocation(target.id, { ...req(), maxBoxes: 1 }),
    /вместимость/,
  );
  await assert.rejects(
    warehouse.updateLocation(target.id, { ...req(), availableWidthMm: 1000 }),
    /ширине/,
  );
  await assert.rejects(
    warehouse.updateLocation(target.id, { ...req(), maxWeightKg: 11 }),
    /масса/,
  );
  await warehouse.updateLocation(target.id, {
    ...req(),
    name: "Подтверждённое имя",
  });
  const raw = await newReceipt([{ skuId: a.skuId, quantity: 1 }]);
  const rawPallet = receivedPallet(raw.state, raw.receipt.id);
  await assert.rejects(
    warehouse.placeReceiptPallet(
      raw.receipt.id,
      rawPallet.id,
      placeBody(rawPallet, target),
    ),
    /зарезервирован/,
  );
  const guardActor = await assemblyActor("Проверка Резервов");
  await assert.rejects(
    warehouse.createMovement({
      ...req(),
      palletId: "pallet-finished-3",
      toLocationId: target.id,
      kind: "transfer",
      employeeId: guardActor.id,
    }),
    /зарезервирован/,
  );
  const box1 = state.boxes.find((b) => b.id === t1.boxId)!,
    from = state.locations.find((l) => l.id === t1.fromLocationId)!;
  const untouched = await warehouse.snapshot();
  await assert.rejects(
    warehouse.takePutawayTask(
      t1.id,
      putawayScan(t1, second, box1.code, from.code),
    ),
    /другой сотрудник/,
  );
  await assert.rejects(
    warehouse.takePutawayTask(
      t1.id,
      putawayScan(t1, owner, "WRONG", from.code),
    ),
    /Неверный/,
  );
  await assert.rejects(
    warehouse.takePutawayTask(
      t1.id,
      putawayScan(t1, owner, box1.code, target.code),
    ),
    /Неверный/,
  );
  assert.deepEqual(await warehouse.snapshot(), untouched);
  const take = {
    ...req(),
    employeeId: owner,
    boxCode: `artmate-wms:box:${box1.code}`,
    locationCode: `artmate-wms:location:${from.id}`,
  };
  state = await warehouse.takePutawayTask(t1.id, take);
  assert.equal(state.balance.totalUnits, untouched.balance.totalUnits);
  assert.equal(state.balance.boxedUnits, untouched.balance.boxedUnits);
  assert.deepEqual(await warehouse.takePutawayTask(t1.id, take), state);
  const carried = state.boxes.find((b) => b.id === box1.id)!;
  assert.equal(carried.status, "in_transit");
  assert.equal(carried.locationId, null);
  assert.equal(carried.palletId, null);
  await assert.rejects(
    warehouse.updateShift(owner, { ...req(), status: "off" }),
    /короб/,
  );
  await assert.rejects(
    warehouse.updateShift(owner, { ...req(), status: "break" }),
    /короб/,
  );
  await assert.rejects(
    warehouse.releasePutawayTask(t1.id, { ...req(), employeeId: owner }),
    /возьмите/,
  );
  const beforeWrongPlace = await warehouse.snapshot();
  await assert.rejects(
    warehouse.placePutawayTask(
      t1.id,
      putawayScan(t1, owner, box1.code, from.code),
    ),
    /Неверный/,
  );
  assert.deepEqual(await warehouse.snapshot(), beforeWrongPlace);
  const place = putawayScan(t1, owner, box1.code, target.code);
  state = await warehouse.placePutawayTask(t1.id, place);
  assert.equal(state.balance.totalUnits, untouched.balance.totalUnits);
  assert.deepEqual(await warehouse.placePutawayTask(t1.id, place), state);
  await assert.rejects(
    warehouse.placePutawayTask(
      t1.id,
      putawayScan(t1, owner, box1.code, target.code),
    ),
    /заберите/,
  );
  const finished = state.pallets.find(
    (p) => p.id === state.boxes.find((b) => b.id === box1.id)!.palletId,
  )!;
  assert.equal(finished.kind, "finished");
  assert.equal(finished.skuId, a.skuId);
  assert.equal(finished.quantity, 1);
  await assert.rejects(
    warehouse.createMovement({
      ...req(),
      palletId: finished.id,
      toLocationId: "loc-picking",
      kind: "lower",
      employeeId: guardActor.id,
    }),
    /зарезервирован/,
  );
  await assert.rejects(
    warehouse.updateLocation(target.id, { ...req(), maxBoxes: 1 }),
    /вместимость/,
  );
  // Release before take gives capacity back; shift end also safely releases a merely claimed task.
  state = await warehouse.updateShift(second, { ...req(), status: "break" });
  const released = state.putawayTasks.find((t) => t.id === t2.id)!;
  assert.equal(released.status, "queued");
  assert.equal(released.toLocationId, null);
  assert.equal(released.employeeId, null);
  assert.equal(released.claimedAt, null);
  state = await warehouse.claimPutawayTask(t3.id, {
    ...req(),
    employeeId: employee3.id,
  });
  assert.equal(
    state.putawayTasks.find((t) => t.id === t3.id)!.toLocationId,
    target.id,
  );
  await warehouse.releasePutawayTask(t3.id, {
    ...req(),
    employeeId: employee3.id,
  });
  const available = await warehouse.getPutawayPlacementOptions(t3.id);
  assert.equal(available.suggestedLocationId, target.id);
  state = await warehouse.createShipment({
    ...req(),
    skuId: a.skuId,
    boxesRequested: 1,
  });
  assert.ok(
    state.shipments.some((s) => s.skuId === a.skuId && s.boxIds[0] === box1.id),
  );
  // Different SKU needs its own pallet/address even when a compatible shape exists nearby.
  const target2 = await assemblyLocation("PUTAWAY-OTHER-THEME", "floor", {
    availableWidthMm: 3200,
    maxBoxes: 2,
    maxWeightKg: 100,
  });
  state = await warehouse.claimPutawayTask(foreign.id, {
    ...req(),
    employeeId: employee3.id,
  });
  assert.equal(
    state.putawayTasks.find((t) => t.id === foreign.id)!.toLocationId,
    target2.id,
  );
  const foreignBox = state.boxes.find((b) => b.id === foreign.boxId)!;
  await warehouse.takePutawayTask(
    foreign.id,
    putawayScan(foreign, employee3.id, foreignBox.code, from.code),
  );
  state = await warehouse.placePutawayTask(
    foreign.id,
    putawayScan(foreign, employee3.id, foreignBox.code, target2.code),
  );
  assert.equal(
    state.pallets.find(
      (p) => p.id === state.boxes.find((b) => b.id === foreignBox.id)!.palletId,
    )!.skuId,
    b.skuId,
  );
});

test("putaway actor cannot overlap primary or pallet moves, no-target claim is atomic, strict DTO rejects missing scans", async () => {
  const result = await packForPutaway("PUTAWAY-NO-TARGET", 1, {
    palletWidthMm: 5000,
    palletWeightKg: 10,
    boxWeightKg: 1,
  });
  const actor = await assemblyActor("Добровольный Исполнитель"),
    primary = await assemblyTask(result.skuId, 1, actor.id);
  await warehouse.claimTask(primary.id, { ...req(), employeeId: actor.id });
  const t = putawayOf(await warehouse.snapshot(), result.boxIds[0]);
  await assert.rejects(
    warehouse.claimPutawayTask(t.id, { ...req(), employeeId: actor.id }),
    /приостановите/,
  );
  await warehouse.updateTaskStatus(primary.id, {
    ...req(),
    employeeId: actor.id,
    status: "paused",
  });
  const before = await warehouse.snapshot();
  await assert.rejects(
    warehouse.claimPutawayTask(t.id, { ...req(), employeeId: actor.id }),
    /Нет подходящего/,
  );
  assert.deepEqual(await warehouse.snapshot(), before);
  const target = await assemblyLocation("PUTAWAY-WIDE", "floor", {
    availableWidthMm: 5200,
  });
  let state = await warehouse.claimPutawayTask(t.id, {
    ...req(),
    employeeId: actor.id,
  });
  await assert.rejects(
    warehouse.claimTask(primary.id, { ...req(), employeeId: actor.id }),
    /размещение/,
  );
  await assert.rejects(
    warehouse.createMovement({
      ...req(),
      palletId: "pallet-finished-3",
      toLocationId: "loc-picking",
      kind: "lower",
      employeeId: actor.id,
    }),
    /размещение/,
  );
  await warehouse.releasePutawayTask(t.id, { ...req(), employeeId: actor.id });
  // A live pallet move also prevents claiming an optional box assignment.
  state = await warehouse.createMovement({
    ...req(),
    palletId: "pallet-finished-3",
    toLocationId: target.id,
    kind: "transfer",
    employeeId: actor.id,
  });
  const move = state.movements.find(
    (m) => m.employeeId === actor.id && m.status === "planned",
  )!;
  await assert.rejects(
    warehouse.claimPutawayTask(t.id, { ...req(), employeeId: actor.id }),
    /текущее задание/,
  );
  await warehouse.cancelMovement(move.id, req());
  const { ValidationPipe } = await import("@nestjs/common"),
    D = await import("../src/dto"),
    { WarehouseController } = await import("../src/app");
  const pipe = (dto: any) =>
    new ValidationPipe({
      expectedType: dto,
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  for (const employeeId of [undefined, null, ""])
    await assert.rejects(
      pipe(D.ClaimPutawayTaskDto).transform(
        { ...req(), employeeId },
        { type: "body" },
      ),
    );
  for (const field of ["employeeId", "boxCode", "locationCode"])
    for (const value of [null, ""])
      await assert.rejects(
        pipe(D.ConfirmPutawayTaskDto).transform(
          {
            ...req(),
            employeeId: actor.id,
            boxCode: "B",
            locationCode: "L",
            [field]: value,
          },
          { type: "body" },
        ),
      );
  await assert.rejects(
    pipe(D.ConfirmPutawayTaskDto).transform(
      {
        ...req(),
        employeeId: actor.id,
        boxCode: "B",
        locationCode: "L",
        targetId: "injected",
      },
      { type: "body" },
    ),
  );
  const controller = new WarehouseController(warehouse);
  state = await controller.claimPutawayTask(
    t.id,
    await pipe(D.ClaimPutawayTaskDto).transform(
      { ...req(), employeeId: actor.id },
      { type: "body" },
    ),
  );
  assert.equal(
    state.putawayTasks.find((p) => p.id === t.id)!.status,
    "claimed",
  );
  await warehouse.releasePutawayTask(t.id, { ...req(), employeeId: actor.id });
});

test("empty mixed accumulator keeps its fixed physical base, reuses across new themes, and retires without losing a carried box", async () => {
  const actor = await assemblyActor("Разгрузка Накопителя");
  let s = await warehouse.snapshot();
  const original = s.pallets.find(
    (p) => p.kind === "assembly" && p.status === "stored",
  )!;
  const base = structuredClone(original.packagingSnapshot!),
    source = s.locations.find((l) => l.id === original.locationId)!;
  const boxIds = s.boxes
    .filter((b) => b.palletId === original.id && b.status === "stored")
    .sort(
      (a, b) =>
        b.packagingSnapshot.palletWidthMm - a.packagingSnapshot.palletWidthMm,
    )
    .map((b) => b.id);
  for (const boxId of boxIds) {
    s = await warehouse.snapshot();
    const box = s.boxes.find((b) => b.id === boxId)!,
      t = putawayOf(s, box.id);
    if (!(await warehouse.getPutawayPlacementOptions(t.id)).suggestedLocationId)
      await assemblyLocation(`UNLOAD-${box.id.slice(0, 8)}`, "floor", {
        availableWidthMm: 10000,
        availableDepthMm: 10000,
        maxBoxes: 100,
        maxHeightMm: 10000,
      });
    s = await warehouse.claimPutawayTask(t.id, {
      ...req(),
      employeeId: actor.id,
    });
    const to = s.locations.find(
      (l) => l.id === s.putawayTasks.find((x) => x.id === t.id)!.toLocationId,
    )!;
    await warehouse.takePutawayTask(
      t.id,
      putawayScan(t, actor.id, box.code, source.code),
    );
    await warehouse.placePutawayTask(
      t.id,
      putawayScan(t, actor.id, box.code, to.code),
    );
  }
  s = await warehouse.snapshot();
  let accumulator = s.pallets.find((p) => p.id === original.id)!;
  assert.equal(accumulator.quantity, 0);
  assert.equal(accumulator.locationId, source.id);
  assert.equal(accumulator.status, "stored");
  assert.equal(accumulator.widthMm, base.palletWidthMm);
  assert.equal(accumulator.depthMm, base.palletDepthMm);
  assert.equal(accumulator.heightMm, base.palletBaseHeightMm);
  assert.equal(accumulator.weightKg, base.palletWeightKg);
  await assert.rejects(warehouse.deleteLocation(source.id, req()), /физически/);
  const reused = await packForPutaway("PUTAWAY-REUSE", 1, {
    palletWidthMm: 2000,
    palletWeightKg: 10,
    boxWeightKg: 2,
  });
  s = await warehouse.snapshot();
  const box = s.boxes.find((b) => b.id === reused.boxIds[0])!,
    t = putawayOf(s, box.id);
  assert.equal(box.palletId, original.id);
  accumulator = s.pallets.find((p) => p.id === original.id)!;
  assert.equal(accumulator.quantity, 1);
  assert.deepEqual(accumulator.packagingSnapshot, base);
  assert.equal(accumulator.widthMm, base.palletWidthMm);
  assert.equal(box.packagingSnapshot.palletWidthMm, 2000);
  if (!(await warehouse.getPutawayPlacementOptions(t.id)).suggestedLocationId)
    await assemblyLocation("REUSE-STORAGE", "floor", {
      availableWidthMm: 10000,
      maxHeightMm: 10000,
      maxBoxes: 100,
    });
  s = await warehouse.claimPutawayTask(t.id, {
    ...req(),
    employeeId: actor.id,
  });
  const target = s.locations.find(
    (l) => l.id === s.putawayTasks.find((x) => x.id === t.id)!.toLocationId,
  )!;
  const balance = s.balance.totalUnits,
    label = await warehouse.getLabel("pallet", original.id);
  s = await warehouse.takePutawayTask(
    t.id,
    putawayScan(t, actor.id, box.code, source.code),
  );
  s = await warehouse.retireEmptyPallet(original.id, {
    ...req(),
    palletCode: original.code,
    locationCode: source.code,
  });
  assert.equal(s.pallets.find((p) => p.id === original.id)!.status, "retired");
  assert.equal(s.balance.totalUnits, balance);
  assert.deepEqual(await warehouse.getLabel("pallet", original.id), label);
  s = await warehouse.placePutawayTask(
    t.id,
    putawayScan(t, actor.id, box.code, target.code),
  );
  assert.equal(s.balance.totalUnits, balance);
  assert.equal(
    s.putawayTasks.find((x) => x.id === t.id)!.fromPalletId,
    original.id,
  );
  // A replacement accumulator uses a fresh base only after the former physical pallet was retired.
  await parkFreeQueue();
  const next = await assemblyStock("NEW-ACCUMULATOR", 1, 3),
    nextActor = await assemblyActor("Новая Паллета Сборки");
  s = await warehouse.snapshot();
  await warehouse.updateSkuPackaging(next.skuId, {
    ...req(),
    packaging: {
      ...s.skus.find((x) => x.id === next.skuId)!.packaging,
      palletWidthMm: 2000,
    },
  });
  const task = await assemblyTask(next.skuId, 1, nextActor.id);
  const before = await warehouse.snapshot(),
    claim = { ...req(), employeeId: nextActor.id };
  // An oversized replacement base is rejected before taking or scanning stock.
  await assert.rejects(
    warehouse.claimTask(task.id, claim),
    /ширине|глубине|место типа «Сборка»/,
  );
  assert.deepEqual(await warehouse.snapshot(), before);
  // Retirement can select another free assembly address as the canonical one.
  const currentAssembly = before.locations.find(
    (location) => location.id === assemblyPressure(before).locationId,
  )!;
  await warehouse.updateLocation(currentAssembly.id, {
    ...req(),
    availableWidthMm: Math.max(currentAssembly.availableWidthMm, 2200),
    availableDepthMm: Math.max(currentAssembly.availableDepthMm, 800),
    maxHeightMm: Math.max(currentAssembly.maxHeightMm, 2200),
    maxBoxes: Math.max(
      currentAssembly.maxBoxes,
      assemblyPressure(before).committedBoxes + 1,
    ),
  });
  await warehouse.claimTask(task.id, claim);
  await actorScan(task, nextActor.id, "source", next.p.code);
  await actorScan(task, nextActor.id, "box", task.openBoxCode);
  const final = {
    ...req(),
    employeeId: nextActor.id,
    kind: "barcode" as const,
    value: "NEW-ACCUMULATOR",
  };
  s = await warehouse.scanTask(task.id, final);
  assert.equal(s.balance.totalUnits, before.balance.totalUnits);
  assert.deepEqual(await warehouse.scanTask(task.id, final), s);
  const replacement = s.pallets.find(
    (p) => p.kind === "assembly" && p.status === "stored",
  )!;
  assert.notEqual(replacement.id, original.id);
  assert.equal(replacement.locationId, currentAssembly.id);
  assert.equal(replacement.widthMm, 2000);
  assert.equal(replacement.skuId, null);
});

test("shipment reservation excludes a physical finished pallet while its move is planned or in transit", async () => {
  const s = await warehouse.snapshot();
  // Select a unique thematic stock produced by the previous putaway scenarios.
  const sku = s.skus.find((s) => s.barcode === "PUTAWAY-B")!;
  const ready = s.pallets.find(
    (p) => p.kind === "finished" && p.skuId === sku.id && p.quantity === 1,
  )!;
  const actor = await assemblyActor("Проверка Готовности Отгрузки");
  const picking = await assemblyLocation("PUTAWAY-SHIP-PICK", "picking", {
    availableWidthMm: 3200,
    accessSides: 4,
  });
  let state = await warehouse.createMovement({
    ...req(),
    palletId: ready.id,
    toLocationId: picking.id,
    kind: "lower",
    employeeId: actor.id,
  });
  const move = state.movements.find(
    (m) => m.palletId === ready.id && m.status === "planned",
  )!;
  await assert.rejects(
    warehouse.createShipment({ ...req(), skuId: sku.id, boxesRequested: 1 }),
    /Недостаточно/,
  );
  await warehouse.takeMovement(move.id, {
    ...req(),
    palletCode: ready.code,
    locationCode: s.locations.find((l) => l.id === ready.locationId)!.code,
  });
  await assert.rejects(
    warehouse.createShipment({ ...req(), skuId: sku.id, boxesRequested: 1 }),
    /Недостаточно/,
  );
  await warehouse.placeMovement(move.id, {
    ...req(),
    palletCode: ready.code,
    locationCode: picking.code,
  });
  state = await warehouse.createShipment({
    ...req(),
    skuId: sku.id,
    boxesRequested: 1,
  });
  assert.ok(
    state.shipments.some((x) => x.skuId === sku.id && x.boxesRequested === 1),
  );
});

test("room group HTTP update moves occupied reserved rotated objects and all rack levels exactly once while preserving stock and untouched axes", async () => {
  await warehouse.updateWarehousePlan({ ...req(), width: 300, depth: 200 });
  let s = await warehouse.createSpace({
    ...req(),
    name: "Группа помещения",
    kind: "room",
    x: 160,
    y: 20,
    width: 30,
    depth: 30,
  });
  const room = s.warehouse.spaces.find((r) => r.name === "Группа помещения")!;
  s = await warehouse.createSpace({
    ...req(),
    name: "Сосед группы",
    kind: "room",
    x: 210,
    y: 20,
    width: 30,
    depth: 30,
  });
  const neighbor = s.warehouse.spaces.find((r) => r.name === "Сосед группы")!;
  const level = (code: string) => ({
    code,
    name: code,
    maxHeightMm: 2200,
    maxBoxes: 36,
    availableWidthMm: 1400,
    availableDepthMm: 1000,
  });
  s = await warehouse.createRackSection({
    ...req(),
    code: "GROUP-SECTION",
    name: "Поворачиваемая секция",
    x: 161.52,
    y: 22.123456789123,
    width: 3,
    depth: 2,
    rotation: 90,
    levels: [level("GROUP-L1"), level("GROUP-L2"), level("GROUP-L3")],
  });
  const section = s.sections.find((r) => r.code === "GROUP-SECTION")!,
    levels = s.locations.filter((l) => l.sectionId === section.id);
  await warehouse.deleteLocation(levels[1].id, req());
  s = await receiveAndPlace(receiptBody(levels[0].id));
  const stock = s.pallets.find((p) => p.locationId === levels[0].id)!;
  const addLocation = async (
    code: string,
    x: number,
    y: number,
    extra = {},
  ) => {
    const result = await warehouse.createLocation({
      ...locationBody(code),
      x,
      y,
      ...extra,
    });
    return result.locations.find((l) => l.code === code)!;
  };
  const standalone = await addLocation(
    "GROUP-OCCUPIED",
    167.52,
    23.987654321123,
    { rotation: 270 },
  );
  await receiveAndPlace(receiptBody(standalone.id));
  const reserved = await addLocation(
    "GROUP-PUTAWAY-RESERVE",
    174.52,
    23.123456789123,
    { width: 9, availableWidthMm: 9000, maxHeightMm: 1000, maxBoxes: 5 },
  );
  // The unrotated width would overhang. Membership must use the actual 90-degree footprint.
  const edge = await addLocation(
    "GROUP-ROTATED-EDGE",
    188.52,
    30.123456789123,
    { width: 6, depth: 1, rotation: 90 },
  );
  const archived = await addLocation(
    "GROUP-ARCHIVED-LOCATION",
    170.52,
    37.123456789123,
  );
  await warehouse.deleteLocation(archived.id, req());
  s = await warehouse.createRackSection({
    ...req(),
    code: "GROUP-ARCHIVED-SECTION",
    name: "Архивная секция",
    x: 170.52,
    y: 42.123456789123,
    width: 3,
    depth: 2,
    levels: [level("GROUP-ARCHIVED-L1")],
  });
  const archivedSection = s.sections.find(
    (r) => r.code === "GROUP-ARCHIVED-SECTION",
  )!;
  await warehouse.deleteRackSection(archivedSection.id, req());
  s = await warehouse.createAisle({
    ...req(),
    name: "GROUP-AISLE",
    x: 161.52,
    y: 33.123456789123,
    width: 10,
    depth: 1,
    rotation: 90,
  });
  const aisle = s.aisles.find((a) => a.name === "GROUP-AISLE")!;
  s = await warehouse.createAisle({
    ...req(),
    name: "GROUP-ARCHIVED-AISLE",
    x: 180.52,
    y: 37.123456789123,
    width: 2,
    depth: 2,
  });
  const archivedAisle = s.aisles.find(
    (a) => a.name === "GROUP-ARCHIVED-AISLE",
  )!;
  await warehouse.deleteAisle(archivedAisle.id, req());
  await addLocation("GROUP-NEIGHBOR-LOCATION", 212.25, 22.135790246813);
  s = await warehouse.createEntrance({
    ...req(),
    name: "GROUP-DOOR",
    spaceId: room.id,
    wall: "north",
    offset: 3.52,
    width: 1,
  });
  const entrance = s.entrances.find((e) => e.name === "GROUP-DOOR")!;
  const packed = await packForPutaway("GROUP-INCOMING", 1, {
    palletWidthMm: 8000,
    palletWeightKg: 10,
    boxWeightKg: 1,
  });
  const actor = await assemblyActor("Групповой Резерв");
  s = await warehouse.claimPutawayTask(
    putawayOf(await warehouse.snapshot(), packed.boxIds[0]).id,
    { ...req(), employeeId: actor.id },
  );
  const incoming = s.putawayTasks.find((t) => t.boxId === packed.boxIds[0])!;
  assert.equal(incoming.toLocationId, reserved.id);
  const before = await warehouse.snapshot(),
    labels = await Promise.all(
      levels.map((l) => warehouse.getLabel("location", l.id)),
    );
  const { ValidationPipe } = await import("@nestjs/common"),
    { UpdateSpaceDto } = await import("../src/dto"),
    { WarehouseController } = await import("../src/app"),
    { globalDoorSegment } = await import("../src/layout");
  const body = await new ValidationPipe({
    expectedType: UpdateSpaceDto,
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }).transform({ ...req(), x: 167.52 }, { type: "body" });
  s = await new WarehouseController(warehouse).updateSpace(room.id, body);
  assert.equal(s.revision, before.revision + 1);
  const movedIds = new Set([
    standalone.id,
    reserved.id,
    edge.id,
    ...levels.map((l) => l.id),
  ]);
  for (const old of before.locations) {
    const expected = movedIds.has(old.id)
      ? { ...old, x: Number((old.x + 7.52).toFixed(10)) }
      : old;
    assert.deepEqual(
      s.locations.find((l) => l.id === old.id),
      expected,
    );
  }
  assert.deepEqual(
    s.sections.find((r) => r.id === section.id),
    { ...section, x: 169.04 },
  );
  assert.deepEqual(
    s.aisles.find((a) => a.id === aisle.id),
    { ...aisle, x: 169.04 },
  );
  assert.deepEqual(
    s.sections.find((r) => r.id === archivedSection.id),
    before.sections.find((r) => r.id === archivedSection.id),
  );
  assert.deepEqual(
    s.aisles.find((a) => a.id === archivedAisle.id),
    before.aisles.find((a) => a.id === archivedAisle.id),
  );
  assert.deepEqual(
    s.warehouse.spaces.find((r) => r.id === neighbor.id),
    neighbor,
  );
  assert.deepEqual(s.entrances, before.entrances);
  const oldDoor = globalDoorSegment(before.warehouse, entrance),
    newDoor = globalDoorSegment(s.warehouse, entrance);
  assert.equal(newDoor.line, oldDoor.line);
  assert.ok(Math.abs(newDoor.start - (oldDoor.start + 7.52)) <= 1e-9);
  for (const key of [
    "pallets",
    "boxes",
    "skus",
    "lots",
    "receipts",
    "tasks",
    "putawayTasks",
    "employees",
    "shipments",
    "movements",
    "balance",
  ] as const)
    assert.deepEqual(s[key], before[key], `${key} remains unchanged`);
  assert.equal(
    s.pallets.find((p) => p.id === stock.id)!.locationId,
    levels[0].id,
  );
  assert.deepEqual(
    await Promise.all(levels.map((l) => warehouse.getLabel("location", l.id))),
    labels,
  );
  assert.deepEqual(await warehouse.updateSpace(room.id, body), s);
  assert.equal((await warehouse.snapshot()).revision, s.revision);
});

test("room/corridor rename resize and zero-delta edits preserve members; translate+resize selects OLD members and every failure rolls back the command", async () => {
  let before = await warehouse.snapshot();
  const room = before.warehouse.spaces.find(
    (r) => r.name === "Группа помещения",
  )!;
  let s = await warehouse.updateSpace(room.id, {
    ...req(),
    name: "Групповой коридор",
    kind: "corridor",
    width: 32,
  });
  for (const key of ["sections", "locations", "aisles", "entrances"] as const)
    assert.deepEqual(s[key], before[key]);
  before = await warehouse.snapshot();
  s = await warehouse.updateSpace(room.id, { ...req(), x: room.x, y: room.y });
  for (const key of ["sections", "locations", "aisles", "entrances"] as const)
    assert.deepEqual(s[key], before[key]);
  const countBefore = s.locations.find((l) => l.code === "GROUP-ROTATED-EDGE")!;
  s = await warehouse.updateSpace(room.id, { ...req(), x: 168.52, width: 33 });
  assert.equal(
    s.locations.find((l) => l.id === countBefore.id)!.x,
    Number((countBefore.x + 1).toFixed(10)),
  );
  assert.equal(
    s.warehouse.spaces.find((r) => r.id === room.id)!.kind,
    "corridor",
  );
  for (const changes of [{ x: 290 }, { x: 211 }, { x: 175.52, width: 5 }]) {
    const unchanged = await warehouse.snapshot();
    await assert.rejects(
      warehouse.updateSpace(room.id, { ...req(), ...changes }),
      /границ|целиком|пересекается/,
    );
    assert.deepEqual(await warehouse.snapshot(), unchanged);
  }
  const request = req(),
    unchanged = await warehouse.snapshot();
  await assert.rejects(
    warehouse.updateSpace(room.id, { ...request, x: 299 }),
    /границ/,
  );
  // Failed mutations do not consume requestId. A corrected request with the same key is a new command.
  s = await warehouse.updateSpace(room.id, { ...request, x: 168.52 });
  assert.equal(s.revision, unchanged.revision + 1);
  assert.deepEqual(s.locations, unchanged.locations);
});

test("incoming putaway reservation still places into the same address after its room group moved", async () => {
  let s = await warehouse.snapshot();
  const sku = s.skus.find((s) => s.barcode === "GROUP-INCOMING")!,
    task = s.putawayTasks.find(
      (t) => t.skuId === sku.id && t.status === "claimed",
    )!;
  const box = s.boxes.find((b) => b.id === task.boxId)!,
    from = s.locations.find((l) => l.id === task.fromLocationId)!,
    to = s.locations.find((l) => l.id === task.toLocationId)!;
  const balance = s.balance.totalUnits;
  await warehouse.takePutawayTask(task.id, {
    ...req(),
    employeeId: task.employeeId!,
    boxCode: box.code,
    locationCode: from.code,
  });
  s = await warehouse.placePutawayTask(task.id, {
    ...req(),
    employeeId: task.employeeId!,
    boxCode: box.code,
    locationCode: to.code,
  });
  assert.equal(s.boxes.find((b) => b.id === box.id)!.locationId, to.id);
  assert.equal(
    s.putawayTasks.find((t) => t.id === task.id)!.status,
    "completed",
  );
  assert.equal(s.balance.totalUnits, balance);
});

async function resizeRoomHttp(id: string, body: Record<string, unknown>) {
  const { ValidationPipe } = await import("@nestjs/common"),
    { ResizeSpaceDto } = await import("../src/dto"),
    { WarehouseController } = await import("../src/app");
  const dto = await new ValidationPipe({
    expectedType: ResizeSpaceDto,
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }).transform({ ...req(), ...body }, { type: "body" });
  return new WarehouseController(warehouse).resizeSpace(id, dto);
}
test("room resize in eight directions preserves all occupied/reserved equipment and local door bindings even when X/Y change", async () => {
  let s = await warehouse.snapshot();
  const room = s.warehouse.spaces.find((r) => r.name === "Групповой коридор")!,
    sku = s.skus.find((s) => s.barcode === "GROUP-INCOMING")!;
  const actor = await assemblyActor("Ресайз Сборщик"),
    putawayActor = await assemblyActor("Ресайз Исполнитель");
  const t = await assemblyTask(sku.id, 1, actor.id);
  await warehouse.claimTask(t.id, { ...req(), employeeId: actor.id });
  s = await warehouse.snapshot();
  const source = s.pallets.find((p) => p.id === t.reservations[0].palletId)!;
  await actorScan(t, actor.id, "source", source.code);
  await actorScan(t, actor.id, "box", t.openBoxCode);
  s = await actorScan(t, actor.id, "barcode", sku.barcode);
  const box = s.boxes.find((b) => b.code === t.openBoxCode)!,
    putaway = putawayOf(s, box.id);
  await warehouse.claimPutawayTask(putaway.id, {
    ...req(),
    employeeId: putawayActor.id,
  });
  s = await warehouse.createEntrance({
    ...req(),
    name: "RESIZE-EAST",
    spaceId: room.id,
    wall: "east",
    offset: 2,
    width: 1,
  });
  s = await warehouse.createEntrance({
    ...req(),
    name: "RESIZE-SOUTH",
    spaceId: room.id,
    wall: "south",
    offset: 5,
    width: 1,
  });
  const baseline = await warehouse.snapshot(),
    old = baseline.warehouse.spaces.find((r) => r.id === room.id)!;
  assert.ok(baseline.locations.some((l) => l.sectionId && l.archived));
  const target = baseline.locations.find(
    (l) =>
      l.id ===
      baseline.putawayTasks.find((p) => p.id === putaway.id)!.toLocationId,
  )!;
  assert.equal(target.code, "GROUP-PUTAWAY-RESERVE");
  const unchanged = [
    "sections",
    "locations",
    "aisles",
    "entrances",
    "pallets",
    "boxes",
    "lots",
    "skus",
    "receipts",
    "tasks",
    "putawayTasks",
    "employees",
    "movements",
    "shipments",
    "balance",
  ] as const;
  const original = { x: old.x, y: old.y, width: old.width, depth: old.depth };
  const handles = {
    e: { ...original, width: old.width + 0.5 },
    w: { ...original, x: old.x - 0.5, width: old.width + 0.5 },
    n: { ...original, y: old.y - 0.5, depth: old.depth + 0.5 },
    s: { ...original, depth: old.depth + 0.5 },
    ne: {
      ...original,
      y: old.y - 0.5,
      width: old.width + 0.5,
      depth: old.depth + 0.5,
    },
    nw: {
      x: old.x - 0.5,
      y: old.y - 0.5,
      width: old.width + 0.5,
      depth: old.depth + 0.5,
    },
    se: { ...original, width: old.width + 0.5, depth: old.depth + 0.5 },
    sw: {
      ...original,
      x: old.x - 0.5,
      width: old.width + 0.5,
      depth: old.depth + 0.5,
    },
  };
  const { globalDoorSegment } = await import("../src/layout");
  let revision = baseline.revision;
  for (const [direction, geometry] of Object.entries(handles)) {
    s = await resizeRoomHttp(old.id, geometry);
    assert.equal(s.revision, ++revision);
    for (const key of unchanged)
      assert.deepEqual(s[key], baseline[key], `${direction}: ${key} unchanged`);
    assert.deepEqual(
      s.warehouse.spaces.find((r) => r.id === old.id),
      { ...old, ...geometry },
    );
    const east = s.entrances.find((e) => e.name === "RESIZE-EAST")!,
      south = s.entrances.find((e) => e.name === "RESIZE-SOUTH")!;
    assert.equal(
      globalDoorSegment(s.warehouse, east).line,
      geometry.x + geometry.width,
    );
    assert.equal(
      globalDoorSegment(s.warehouse, south).line,
      geometry.y + geometry.depth,
    );
  }
  const body = { ...req(), ...original },
    first = await resizeRoomHttp(old.id, body);
  assert.deepEqual(await resizeRoomHttp(old.id, body), first);
  assert.equal((await warehouse.snapshot()).revision, first.revision);
  for (const key of unchanged) assert.deepEqual(first[key], baseline[key]);
  // Crop all four sides without moving any equipment, including an incoming capacity reservation.
  s = await resizeRoomHttp(old.id, {
    x: old.x + 1,
    y: old.y + 1,
    width: old.width - 2,
    depth: old.depth - 2,
  });
  for (const key of unchanged) assert.deepEqual(s[key], baseline[key]);
  const current = s.warehouse.spaces.find((r) => r.id === old.id)!;
  const before = await warehouse.snapshot();
  await assert.rejects(
    resizeRoomHttp(old.id, {
      x: old.x + 3,
      y: old.y,
      width: old.width - 3,
      depth: old.depth,
    }),
    /том же участке/,
  );
  assert.deepEqual(await warehouse.snapshot(), before);
  // The held address remains usable after boundary-only edits; its code, ID and contents never moved.
  const claimed = s.putawayTasks.find((p) => p.id === putaway.id)!,
    from = s.locations.find((l) => l.id === claimed.fromLocationId)!;
  await warehouse.takePutawayTask(putaway.id, {
    ...req(),
    employeeId: putawayActor.id,
    boxCode: box.code,
    locationCode: from.code,
  });
  s = await warehouse.placePutawayTask(putaway.id, {
    ...req(),
    employeeId: putawayActor.id,
    boxCode: box.code,
    locationCode: target.code,
  });
  assert.equal(s.boxes.find((b) => b.id === box.id)!.locationId, target.id);
  assert.deepEqual(
    s.warehouse.spaces.find((r) => r.id === old.id),
    current,
  );
});

test("working field expansion keeps the layout mode and objects, permits a large new room below, and rejects unsafe shrink", async () => {
  let before = await warehouse.snapshot();
  const geometry = { x: 0, y: 220, width: 100, depth: 30 };
  await assert.rejects(
    warehouse.createSpace({
      ...req(),
      name: "Большое помещение снизу",
      kind: "room",
      ...geometry,
    }),
    /границы/,
  );
  assert.deepEqual(await warehouse.snapshot(), before);
  const { ValidationPipe } = await import("@nestjs/common"),
    { UpdateWarehousePlanDto } = await import("../src/dto"),
    { WarehouseController } = await import("../src/app");
  const field = async (body: Record<string, unknown>) =>
    new WarehouseController(warehouse).updateWarehousePlan(
      await new ValidationPipe({
        expectedType: UpdateWarehousePlanDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }).transform({ ...req(), ...body }, { type: "body" }),
    );
  let s = await field({ width: 310, depth: 260 });
  assert.equal(s.warehouse.layoutMode, before.warehouse.layoutMode);
  assert.deepEqual(s.warehouse.spaces, before.warehouse.spaces);
  for (const key of [
    "locations",
    "sections",
    "aisles",
    "entrances",
    "pallets",
    "boxes",
    "putawayTasks",
    "balance",
  ] as const)
    assert.deepEqual(s[key], before[key]);
  s = await warehouse.createSpace({
    ...req(),
    name: "Большое помещение снизу",
    kind: "room",
    ...geometry,
  });
  assert.ok(
    s.warehouse.spaces.some(
      (r) => r.name === "Большое помещение снизу" && r.y === 220,
    ),
  );
  before = await warehouse.snapshot();
  await assert.rejects(field({ depth: 249.9 }), /границы/);
  assert.deepEqual(await warehouse.snapshot(), before);
  await assert.rejects(field({ width: 239.9 }), /границы/);
  assert.deepEqual(await warehouse.snapshot(), before);
  s = await field({ width: 300, depth: 250 });
  assert.deepEqual(s.warehouse.spaces, before.warehouse.spaces);
  assert.deepEqual(s.locations, before.locations);
  for (const body of [
    { width: 0.9 },
    { depth: 1000.1 },
    { width: null },
    { depth: NaN },
    { x: 1 },
  ])
    await assert.rejects(field(body));
});

async function copySectionHttp(id: string, body: Record<string, unknown>) {
  const { ValidationPipe } = await import("@nestjs/common"),
    { CopyRackSectionDto } = await import("../src/dto"),
    { WarehouseController } = await import("../src/app");
  const dto = await new ValidationPipe({
    expectedType: CopyRackSectionDto,
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }).transform({ ...req(), ...body }, { type: "body" });
  return new WarehouseController(warehouse).copyRackSection(id, dto);
}
test("section copy creates new empty identities for active tiers with exact physical settings, excluding archived tiers and retaining source stock/reservations", async () => {
  const profile = (code: string, extra = {}) => ({
    code,
    name: code,
    maxHeightMm: 2100,
    maxBoxes: 31,
    availableWidthMm: 1600,
    availableDepthMm: 1200,
    maxWeightKg: null as number | null,
    accessSides: 1,
    ...extra,
  });
  let s = await warehouse.createRackSection({
    ...req(),
    code: "COPY-SOURCE",
    name: "Источник копирования",
    x: 5,
    y: 222,
    width: 9,
    depth: 1.3,
    rotation: 90,
    levels: [
      profile("COPY-ORIGINAL-1"),
      profile("COPY-ARCHIVED-2", { maxHeightMm: 999 }),
      profile("COPY-BLOCKED-3", {
        maxHeightMm: 1600,
        maxBoxes: 18,
        availableWidthMm: 1400,
        availableDepthMm: 1000,
        maxWeightKg: 600,
        accessSides: 4,
      }),
      profile("COPY-RESERVED-4", {
        maxHeightMm: 450,
        maxBoxes: 5,
        availableWidthMm: 10000,
        availableDepthMm: 1000,
        maxWeightKg: 100,
        accessSides: 2,
      }),
    ],
  });
  const source = s.sections.find((r) => r.code === "COPY-SOURCE")!,
    levels = s.locations
      .filter((l) => l.sectionId === source.id)
      .sort((a, b) => a.level - b.level);
  await warehouse.deleteLocation(levels[1].id, req());
  await warehouse.updateLocation(levels[2].id, { ...req(), blocked: true });
  await receiveAndPlace(receiptBody(levels[0].id));
  // Archived codes and names still reserve identities, including unused high child numbers.
  const archivedFloor = async (code: string, x: number) => {
    const result = await warehouse.createLocation({
      ...locationBody(code),
      x,
      y: 238,
      width: 1,
      depth: 1,
    });
    await warehouse.deleteLocation(
      result.locations.find((l) => l.code === code.trim())!.id,
      req(),
    );
  };
  const archivedSection = async (code: string, name: string, x: number) => {
    const result = await warehouse.createRackSection({
      ...req(),
      code,
      name,
      x,
      y: 238,
      width: 1,
      depth: 1,
      levels: [profile(`HOLD-${x}`)],
    });
    await warehouse.deleteRackSection(
      result.sections.find((r) => r.code === code.trim())!.id,
      req(),
    );
  };
  await archivedFloor(" r-01-20 ", 10);
  await archivedSection(" r-02 ", "Зарезервированный архив", 13);
  await archivedSection("COPY-NAME-HOLD", " СЕКЦИЯ 3 ", 17);
  await archivedFloor(" R-04 ", 21);
  await archivedSection(" R-05-20 ", "Дочерний код секцией", 25);
  const packed = await packForPutaway("COPY-INCOMING", 1, {
      palletWidthMm: 5000,
      palletWeightKg: 10,
      boxWeightKg: 1,
    }),
    actor = await assemblyActor("Резерв Исходной Секции");
  s = await warehouse.claimPutawayTask(
    putawayOf(await warehouse.snapshot(), packed.boxIds[0]).id,
    { ...req(), employeeId: actor.id },
  );
  assert.equal(
    s.putawayTasks.find((t) => t.boxId === packed.boxIds[0])!.toLocationId,
    levels[3].id,
  );
  const before = await warehouse.snapshot(),
    body = { ...req(), x: 98.7, y: 240 };
  s = await copySectionHttp(source.id, body);
  const copy = s.sections.find(
    (r) => !before.sections.some((old) => old.id === r.id),
  )!;
  assert.equal(copy.code, "R-06");
  assert.equal(copy.name, "Секция 6");
  assert.deepEqual(copy, {
    ...source,
    id: copy.id,
    code: "R-06",
    name: "Секция 6",
    x: 98.7,
    y: 240,
    archived: false,
    archivedAt: null,
    archivedLocationIds: [],
  });
  const children = s.locations
      .filter((l) => l.sectionId === copy.id)
      .sort((a, b) => a.level - b.level),
    originals = before.locations
      .filter((l) => l.sectionId === source.id && !l.archived)
      .sort((a, b) => a.level - b.level);
  assert.equal(children.length, 3);
  assert.deepEqual(
    children.map((l) => l.level),
    [1, 2, 3],
  );
  for (const [index, child] of children.entries()) {
    const original = originals[index];
    assert.notEqual(child.id, original.id);
    assert.deepEqual(child, {
      ...original,
      id: child.id,
      code: `R-06-${String(index + 1).padStart(2, "0")}`,
      name: `Секция 6 · Ярус ${index + 1}`,
      sectionId: copy.id,
      level: index + 1,
      levels: 1,
      x: 98.7,
      y: 240,
      width: source.width,
      depth: source.depth,
      rotation: source.rotation,
      archived: false,
      archivedAt: null,
    });
    assert.notEqual(
      (await warehouse.getLabel("location", child.id)).payload,
      (await warehouse.getLabel("location", original.id)).payload,
    );
    assert.ok(
      !s.pallets.some(
        (p) => p.locationId === child.id || p.returnLocationId === child.id,
      ),
    );
    assert.ok(
      !s.putawayTasks.some(
        (t) => t.toLocationId === child.id || t.fromLocationId === child.id,
      ),
    );
    assert.ok(
      !s.movements.some(
        (m) => m.toLocationId === child.id || m.fromLocationId === child.id,
      ),
    );
  }
  assert.equal(children[1].blocked, true);
  for (const key of [
    "pallets",
    "boxes",
    "receipts",
    "lots",
    "skus",
    "tasks",
    "putawayTasks",
    "shipments",
    "employees",
    "movements",
    "aisles",
    "entrances",
    "warehouse",
    "balance",
  ] as const)
    assert.deepEqual(s[key], before[key], `${key} unchanged`);
  for (const original of before.sections)
    assert.deepEqual(
      s.sections.find((r) => r.id === original.id),
      original,
    );
  for (const original of before.locations)
    assert.deepEqual(
      s.locations.find((l) => l.id === original.id),
      original,
    );
  assert.equal(s.revision, before.revision + 1);
  assert.deepEqual(await copySectionHttp(source.id, body), s);
  assert.equal((await warehouse.snapshot()).revision, s.revision);
  await assert.rejects(
    copySectionHttp(source.id, { ...body, x: 70 }),
    /requestId/,
  );
  assert.equal((await warehouse.snapshot()).revision, s.revision);
});

test("copy section rejects invalid HTTP bodies, missing/archived/empty source, and rolls back bounds, aisle and geometry conflicts", async () => {
  const source = (await warehouse.snapshot()).sections.find(
    (r) => r.code === "COPY-SOURCE",
  )!;
  const before = await warehouse.snapshot();
  for (const coordinate of ["x", "y"])
    for (const value of [
      undefined,
      null,
      NaN,
      Infinity,
      "5",
      true,
      -0.1,
      1000.1,
    ]) {
      const body: Record<string, unknown> = {
        x: 70,
        y: 222,
        [coordinate]: value,
      };
      if (value === undefined) delete body[coordinate];
      await assert.rejects(
        copySectionHttp(source.id, body),
        (e: any) => e.getStatus() === 400,
      );
    }
  for (const extra of [
    { width: 1 },
    { name: "manual" },
    { rotation: 0 },
    { levels: [] },
  ])
    await assert.rejects(
      copySectionHttp(source.id, { x: 70, y: 222, ...extra }),
    );
  assert.deepEqual(await warehouse.snapshot(), before);
  await assert.rejects(
    copySectionHttp(randomUUID(), { x: 70, y: 222 }),
    (e: any) => e.getStatus() === 404,
  );
  const archived = before.sections.find((r) => r.code === "r-02")!;
  await assert.rejects(
    copySectionHttp(archived.id, { x: 70, y: 222 }),
    /архиве/,
  );
  let s = await warehouse.createRackSection({
    ...req(),
    code: "COPY-EMPTY",
    name: "Без активных ярусов",
    x: 35,
    y: 240,
    width: 1,
    depth: 1,
    levels: [
      {
        code: "COPY-EMPTY-1",
        name: "Empty",
        maxHeightMm: 1500,
        maxBoxes: 20,
        availableWidthMm: 1400,
        availableDepthMm: 1000,
      },
    ],
  });
  const empty = s.sections.find((r) => r.code === "COPY-EMPTY")!;
  await warehouse.deleteLocation(
    s.locations.find((l) => l.sectionId === empty.id)!.id,
    req(),
  );
  await assert.rejects(
    copySectionHttp(empty.id, { x: 70, y: 222 }),
    /нет активных ярусов/,
  );
  await warehouse.createAisle({
    ...req(),
    name: "COPY-AISLE",
    x: 30,
    y: 222,
    width: 4,
    depth: 12,
  });
  for (const geometry of [
    { x: source.x, y: source.y },
    { x: 30.5, y: 223 },
    { x: 300, y: 240 },
    { x: 130, y: 230 },
  ]) {
    const unchanged = await warehouse.snapshot();
    await assert.rejects(
      copySectionHttp(source.id, geometry),
      /пересекается|границы|целиком/,
    );
    assert.deepEqual(await warehouse.snapshot(), unchanged);
  }
});

test("separate clients copy to different targets atomically with distinct generated identities and no duplicate child codes", async () => {
  const before = await warehouse.snapshot(),
    source = before.sections.find((r) => r.code === "COPY-SOURCE")!;
  const other = process.env.WMS_TEST_DATABASE_URL
    ? new WarehouseService()
    : warehouse;
  try {
    const responses = await Promise.all([
      warehouse.copyRackSection(source.id, { ...req(), x: 50, y: 222 }),
      other.copyRackSection(source.id, { ...req(), x: 60, y: 222 }),
    ]);
    const state = await warehouse.snapshot(),
      copies = state.sections.filter(
        (r) => !before.sections.some((old) => old.id === r.id),
      );
    assert.deepEqual(copies.map((r) => r.code).sort(), ["R-07", "R-08"]);
    assert.equal(state.revision, before.revision + 2);
    assert.equal(
      new Set(state.sections.map((r) => r.code.trim().toLowerCase())).size,
      state.sections.length,
    );
    const generated = state.locations.filter((l) =>
      copies.some((r) => r.id === l.sectionId),
    );
    assert.equal(generated.length, 6);
    assert.equal(new Set(generated.map((l) => l.code.toLowerCase())).size, 6);
    for (const child of generated)
      assert.ok(
        !before.locations.some(
          (l) => l.code.trim().toLowerCase() === child.code.toLowerCase(),
        ),
      );
    for (const response of responses)
      assert.ok(response.sections.some((r) => r.code === "R-07"));
    assert.deepEqual(await other.snapshot(), state);
    for (const key of [
      "pallets",
      "boxes",
      "receipts",
      "lots",
      "skus",
      "tasks",
      "putawayTasks",
      "shipments",
      "employees",
      "movements",
      "balance",
    ] as const)
      assert.deepEqual(state[key], before[key]);
  } finally {
    if (other !== warehouse) await other.onModuleDestroy();
  }
});

test("full warehouse trace including mixed-lot packing, movement, partial shipping and legacy stock reconciles every ledger position", async () => {
  const page = await warehouse.getStockLedger({});
  assert.equal(page.summary.reconciled, true);
  assert.equal(
    page.summary.ledgerUnits,
    (await warehouse.snapshot()).balance.totalUnits,
  );
  const events = [];
  for (let pageNumber = 1; ; pageNumber++) {
    const part = await warehouse.getStockLedger({
      page: pageNumber,
      pageSize: 100,
    });
    events.push(...part.items);
    if (events.length >= part.total) break;
  }
  assert.equal(
    events.some((e) => e.kind === "shipment" && e.unitsDelta < 0),
    true,
  );
  assert.equal(
    events.some(
      (e) =>
        e.kind === "assembly" && new Set(e.lines.map((l) => l.lotId)).size > 1,
    ),
    true,
  );
  for (const event of events.filter((e) =>
    ["assembly", "putaway", "movement"].includes(e.kind),
  )) {
    const lots = new Map<string, number>();
    for (const line of event.lines) {
      const key = JSON.stringify([line.skuId, line.lotId]);
      lots.set(key, (lots.get(key) ?? 0) + line.quantityDelta);
    }
    assert.equal(
      [...lots.values()].every((q) => q === 0),
      true,
    );
  }
});

test("inline receipt catalog products use the measured current packaging default without rewriting old SKUs", async () => {
  const { DEFAULT_PACKAGING } = await import("../src/physical");
  const previous = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  const warehouse = new WarehouseService();
  try {
    const before = await warehouse.snapshot();
    const result = await warehouse.createReceipt({
      requestId: randomUUID(),
      receivedAt: new Date().toISOString(),
      pallets: [
        {
          newSku: {
            name: "Measured new product",
            barcode: "MEASURED-NEW-RECEIPT",
          },
          quantity: 1000,
        },
      ],
    });
    const sku = result.skus.find((s) => s.barcode === "MEASURED-NEW-RECEIPT")!;
    assert.deepEqual(sku.packaging, DEFAULT_PACKAGING);
    assert.notEqual(sku.packaging, DEFAULT_PACKAGING);
    for (const old of before.skus)
      assert.deepEqual(
        result.skus.find((s) => s.id === old.id),
        old,
      );
    assert.equal(result.pallets.find((p) => p.skuId === sku.id)!.widthMm, 1200);
    assert.equal(result.pallets.find((p) => p.skuId === sku.id)!.depthMm, 800);
  } finally {
    await warehouse.onModuleDestroy();
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
  }
});
