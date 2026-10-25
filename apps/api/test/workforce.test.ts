import "reflect-metadata";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { WarehouseService } from "../src/warehouse.service";
import * as D from "../src/dto";
const req = () => ({ requestId: randomUUID() });
let w: WarehouseService, employee: D.EmployeeDto, raw: D.PalletDto;
let rawLocation: D.LocationDto, shipping: D.LocationDto;
before(async () => {
  const url = process.env.WMS_WORKFORCE_TEST_DATABASE_URL;
  if (url) {
    const name = new Client({ connectionString: url }).database ?? "";
    if (!name.endsWith("_test") || name === "artmate_wms")
      throw new Error("Use isolated _test database");
    process.env.DATABASE_URL = url;
    delete process.env.WMS_DATA_DIR;
  } else process.env.WMS_DATA_DIR = "memory://";
  w = new WarehouseService();
  await w.updateWarehousePlan({ ...req(), width: 100, depth: 100 });
});
after(async () => w?.onModuleDestroy());
const events = () => w.getWorkHistory({ pageSize: 100 });
const shiftRows = (employeeId: string) =>
  w.authTransaction(async (tx) => ({
    shifts: (
      await tx.query(
        "SELECT * FROM employee_shifts WHERE employee_id=$1 ORDER BY id",
        [employeeId],
      )
    ).rows,
    intervals: (
      await tx.query(
        "SELECT i.* FROM shift_intervals i JOIN employee_shifts s ON s.id=i.shift_id WHERE s.employee_id=$1 ORDER BY i.id",
        [employeeId],
      )
    ).rows,
  }));
async function newEmployee(name: string) {
  const state = await w.createEmployee({ ...req(), name });
  return state.employees.find((e) => e.name === name)!;
}
async function location(code: string, x: number, kind = "floor") {
  const state = await w.createLocation({
    ...req(),
    code,
    name: code,
    kind,
    x,
    y: 30,
    width: 2,
    depth: 2,
    levels: 1,
    maxHeightMm: 2500,
    maxBoxes: 36,
    availableWidthMm: 1400,
    availableDepthMm: 1000,
    accessSides: 4,
  });
  return state.locations.find((l) => l.code === code)!;
}
test("tracking begins with observed current statuses only and ignores legacy employee counters and existing boxes", async () => {
  const report = await w.getPerformance({});
  assert.equal(report.employees.length, (await w.snapshot()).employees.length);
  assert.equal(
    report.employees.every((e) =>
      Object.values(e.metrics)
        .filter((_, i) => i < 5)
        .every((q) => q === 0),
    ),
    true,
  );
  assert.equal((await events()).total, 0);
  const history = await w.getShiftHistory({ pageSize: 100 });
  assert.equal(
    history.total,
    (await w.snapshot()).employees.filter((e) => e.status !== "off").length,
  );
  for (const shift of history.items) {
    assert.equal(shift.origin, "observed_from_migration");
    assert.equal(shift.startedAt, report.trackingSince);
    assert.equal(shift.startedByEmployeeId, null);
    assert.equal(shift.intervals.length, 1);
  }
});
test("strict shift transitions preserve assignments, same-status commands and replay never open another interval, ended shift replay remains stable", async () => {
  employee = await newEmployee("Смена lifecycle");
  const original = await w.snapshot();
  await assert.rejects(
    w.updateShift(employee.id, { ...req(), status: "break" }),
    /начните/,
  );
  assert.deepEqual(await w.snapshot(), original);
  const start = { ...req(), status: "working" };
  await w.updateShift(employee.id, start);
  await w.updateShift(employee.id, start);
  await w.updateShift(employee.id, { ...req(), status: "working" });
  let history = await w.getShiftHistory({ employeeId: employee.id });
  assert.equal(history.total, 1);
  assert.equal(history.items[0].intervals.length, 1);
  assert.equal(history.items[0].origin, "explicit");
  await w.updateShift(employee.id, { ...req(), status: "break" });
  await w.updateShift(employee.id, { ...req(), status: "break" });
  await w.updateShift(employee.id, { ...req(), status: "working" });
  const end = { ...req(), status: "off" };
  const ended = await w.updateShift(employee.id, end);
  history = await w.getShiftHistory({ employeeId: employee.id });
  assert.deepEqual(
    history.items[0].intervals.map((i) => i.status),
    ["working", "break", "working"],
  );
  assert.notEqual(history.items[0].endedAt, null);
  assert.equal(history.items[0].endedByEmployeeId, employee.id);
  assert.deepEqual(await w.updateShift(employee.id, end), ended);
  await w.updateShift(employee.id, { ...req(), status: "off" });
  assert.equal(
    (await w.getShiftHistory({ employeeId: employee.id })).items[0].intervals
      .length,
    3,
  );
  await w.updateShift(employee.id, { ...req(), status: "working" });
  assert.equal((await w.getShiftHistory({ employeeId: employee.id })).total, 2);
  const first = await w.getShiftHistory({
      employeeId: employee.id,
      page: 1,
      pageSize: 1,
    }),
    second = await w.getShiftHistory({
      employeeId: employee.id,
      page: 2,
      pageSize: 1,
    });
  assert.notEqual(first.items[0].id, second.items[0].id);
  assert.equal((await events()).total, 0);
});
test("only factual completions count: no scans claims releases corrections retirement or shipment, full units count once, movement/putaway carrying blocks shift end atomically", async () => {
  rawLocation = await location("WORK-RAW", 30);
  shipping = await location("WORK-SHIP", 33, "shipping");
  const barcode = `WORK-${randomUUID()}`;
  let state = await w.createReceipt({
    ...req(),
    receivedAt: "2026-10-01T10:00:00Z",
    pallets: [
      {
        newSku: { name: "Выработка", barcode, unitsPerBox: 2 },
        quantity: 2,
        widthMm: 1200,
        depthMm: 800,
        heightMm: 600,
      },
    ],
  });
  const sku = state.skus.find((s) => s.barcode === barcode)!,
    receipt = state.receipts.find((r) =>
      r.pallets.some((p) => p.skuId === sku.id),
    )!;
  raw = state.pallets.find((p) => p.id === receipt.pallets[0].palletId)!;
  const place = {
    ...req(),
    employeeId: employee.id,
    palletCode: raw.code,
    locationCode: rawLocation.code,
  };
  await w.placeReceiptPallet(receipt.id, raw.id, place);
  await w.placeReceiptPallet(receipt.id, raw.id, place);
  assert.equal((await events()).total, 1);
  state = await w.createTask({
    ...req(),
    skuId: sku.id,
    boxesTarget: 1,
    employeeId: employee.id,
  });
  const task = state.tasks.find((t) => t.skuId === sku.id)!;
  await w.claimTask(task.id, { ...req(), employeeId: employee.id });
  await w.scanTask(task.id, {
    ...req(),
    employeeId: employee.id,
    kind: "source",
    value: raw.code,
  });
  await w.scanTask(task.id, {
    ...req(),
    employeeId: employee.id,
    kind: "box",
    value: task.openBoxCode,
  });
  await w.scanTask(task.id, {
    ...req(),
    employeeId: employee.id,
    kind: "barcode",
    value: barcode,
  });
  assert.equal((await events()).total, 1);
  const oldPeriod = await w.getPerformance({
    employeeId: employee.id,
    from: "2020-01-01",
    to: "2020-01-01",
  });
  assert.equal(oldPeriod.employees[0].metrics.boxesPacked, 0);
  assert.notEqual(oldPeriod.employees[0].currentShift, null);
  assert.equal(
    oldPeriod.employees[0].currentJobs.some((j) => j.id === task.id),
    true,
  );
  await w.updateShift(employee.id, { ...req(), status: "break" });
  let current = await w.snapshot();
  assert.equal(current.tasks.find((t) => t.id === task.id)!.status, "paused");
  assert.equal(
    current.tasks.find((t) => t.id === task.id)!.employeeId,
    employee.id,
  );
  assert.equal(
    current.tasks.find((t) => t.id === task.id)!.reservations[0].quantity,
    1,
  );
  await w.updateShift(employee.id, { ...req(), status: "working" });
  await w.updateTaskStatus(task.id, {
    ...req(),
    employeeId: employee.id,
    status: "active",
  });
  const final = {
    ...req(),
    employeeId: employee.id,
    kind: "barcode" as const,
    value: barcode,
  };
  state = await w.scanTask(task.id, final);
  await w.scanTask(task.id, final);
  const box = state.boxes.find((b) => b.code === task.openBoxCode)!,
    put = state.putawayTasks.find((p) => p.boxId === box.id)!;
  assert.equal((await events()).total, 2);
  await w.claimPutawayTask(put.id, { ...req(), employeeId: employee.id });
  await w.updateShift(employee.id, { ...req(), status: "break" });
  assert.equal(
    (await w.snapshot()).putawayTasks.find((t) => t.id === put.id)!.status,
    "queued",
  );
  await w.updateShift(employee.id, { ...req(), status: "working" });
  state = await w.claimPutawayTask(put.id, {
    ...req(),
    employeeId: employee.id,
  });
  const active = state.putawayTasks.find((t) => t.id === put.id)!,
    to = state.locations.find((l) => l.id === active.toLocationId)!;
  await w.takePutawayBox(put.id, {
    ...req(),
    employeeId: employee.id,
    boxCode: box.code,
  });
  let before = await w.snapshot(),
    history = await shiftRows(employee.id);
  for (const status of ["break", "off"]) {
    await assert.rejects(
      w.updateShift(employee.id, { ...req(), status }),
      /разместите короб/,
    );
    assert.deepEqual(await w.snapshot(), before);
    assert.deepEqual(await shiftRows(employee.id), history);
  }
  const putPlace = {
    ...req(),
    employeeId: employee.id,
    locationCode: to.code,
  };
  state = await w.placePutawayBox(put.id, putPlace);
  await w.placePutawayBox(put.id, putPlace);
  const finished = state.pallets.find(
    (p) => p.id === state.boxes.find((b) => b.id === box.id)!.palletId,
  )!;
  state = await w.createMovement({
    ...req(),
    palletId: finished.id,
    toLocationId: shipping.id,
    employeeId: employee.id,
    kind: "transfer",
  });
  const movement = state.movements.find(
    (m) => m.palletId === finished.id && m.status === "planned",
  )!;
  await w.takeMovement(movement.id, {
    ...req(),
    palletCode: finished.code,
    locationCode: to.code,
  });
  before = await w.snapshot();
  history = await shiftRows(employee.id);
  const workBefore = await events();
  for (const status of ["break", "off"]) {
    await assert.rejects(
      w.updateShift(employee.id, { ...req(), status }),
      /паллетой в пути/,
    );
    assert.deepEqual(await w.snapshot(), before);
    assert.deepEqual(await shiftRows(employee.id), history);
    assert.deepEqual(await events(), workBefore);
  }
  const moved = {
    ...req(),
    palletCode: finished.code,
    locationCode: shipping.code,
  };
  await w.placeMovement(movement.id, moved);
  await w.placeMovement(movement.id, moved);
  let metric = (await w.getPerformance({ employeeId: employee.id }))
    .employees[0].metrics;
  assert.equal(metric.boxesPacked, 1);
  assert.equal(metric.unitsPacked, 2);
  assert.equal(metric.receiptPalletsPlaced, 1);
  assert.equal(metric.putawayBoxesPlaced, 1);
  assert.equal(metric.movementPalletsPlaced, 1);
  assert.equal(
    (await events()).items
      .filter((e) => e.employeeId === employee.id)
      .reduce((sum, e) => sum + e.units, 0),
    2,
  );
  // The assembled raw pallet has already released its address. Use a distinct
  // physical pallet to verify that counts and manual retirement add no output.
  const physical = (await w.snapshot()).pallets.find(
    (p) => p.id === "pallet-raw-3",
  )!;
  const physicalLocation = (await w.snapshot()).locations.find(
    (l) => l.id === physical.locationId,
  )!;
  await w.adjustStock({
    ...req(),
    kind: "raw_count",
    targetId: physical.id,
    employeeId: employee.id,
    expectedLocationId: physicalLocation.id,
    expectedQuantity: physical.quantity,
    countedQuantity: 1,
    reason: "Фактический пересчёт",
  });
  await w.adjustStock({
    ...req(),
    kind: "raw_count",
    targetId: physical.id,
    employeeId: employee.id,
    expectedLocationId: physicalLocation.id,
    expectedQuantity: 1,
    countedQuantity: 0,
    reason: "Повторный пересчёт",
  });
  state = await w.createShipment({
    ...req(),
    skuId: sku.id,
    boxesRequested: 1,
  });
  await w.shipShipment(
    state.shipments.find((s) => s.skuId === sku.id)!.id,
    req(),
  );
  await w.retireEmptyPallet(physical.id, {
    ...req(),
    palletCode: physical.code,
    locationCode: physicalLocation.code,
  });
  assert.deepEqual(
    (await w.getPerformance({ employeeId: employee.id })).employees[0].metrics
      .boxesPacked,
    metric.boxesPacked,
  );
  assert.equal((await events()).total, 4);
  const all = (await events()).items;
  assert.equal(
    all.every((e) => e.shiftId !== null),
    true,
  );
  assert.equal(
    all.find((e) => e.kind === "movement_pallet_placed")!.employeeId,
    employee.id,
  );
});
test("append-only work_events and failure insertion rollback warehouse revision ledger and request key together", async () => {
  await assert.rejects(
    w.authTransaction((tx) => tx.query("UPDATE work_events SET units=units+1")),
    /immutable/,
  );
  await assert.rejects(
    w.authTransaction((tx) => tx.query("DELETE FROM work_events")),
    /immutable/,
  );
  const target = await location("WORK-ROLLBACK", 36),
    barcode = `FAIL-${randomUUID()}`;
  let state = await w.createReceipt({
    ...req(),
    receivedAt: "2026-10-02T10:00:00Z",
    pallets: [
      {
        newSku: { name: "Ошибка выработки", barcode, unitsPerBox: 2 },
        quantity: 2,
        widthMm: 1200,
        depthMm: 800,
        heightMm: 600,
      },
    ],
  });
  const sku = state.skus.find((s) => s.barcode === barcode)!,
    r = state.receipts.find((r) => r.pallets.some((p) => p.skuId === sku.id))!,
    p = state.pallets.find((p) => p.id === r.pallets[0].palletId)!;
  const command = {
      ...req(),
      employeeId: employee.id,
      palletCode: p.code,
      locationCode: target.code,
    },
    snapshot = await w.snapshot(),
    ledger = await w.getStockLedger({}),
    history = await events();
  await w.authTransaction(async (tx) => {
    await tx.query(
      "CREATE FUNCTION fail_work_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'work event failed'; END; $$",
    );
    await tx.query(
      "CREATE TRIGGER fail_work_test BEFORE INSERT ON work_events FOR EACH ROW EXECUTE FUNCTION fail_work_test()",
    );
  });
  try {
    await assert.rejects(
      w.placeReceiptPallet(r.id, p.id, command),
      /work event failed/,
    );
    assert.deepEqual(await w.snapshot(), snapshot);
    assert.deepEqual(await w.getStockLedger({}), ledger);
    assert.deepEqual(await events(), history);
  } finally {
    await w.authTransaction(async (tx) => {
      await tx.query("DROP TRIGGER fail_work_test ON work_events");
      await tx.query("DROP FUNCTION fail_work_test()");
    });
  }
  await w.placeReceiptPallet(r.id, p.id, command);
  await w.placeReceiptPallet(r.id, p.id, command);
  assert.equal((await events()).total, history.total + 1);
});

test("Moscow inclusive dates use half-open UTC bounds, night intervals clip per day while work completion follows occurrence not shift start", async () => {
  const e = await newEmployee("Ночная смена"),
    shift = randomUUID();
  await w.authTransaction(async (tx) => {
    await tx.query(
      "INSERT INTO employee_shifts(id,employee_id,employee_name,started_at,ended_at,origin) VALUES($1,$2,$3,'2026-10-20T20:30:00Z','2026-10-21T00:30:00Z','explicit')",
      [shift, e.id, e.name],
    );
    for (const [status, start, end] of [
      ["working", "2026-10-20T20:30:00Z", "2026-10-20T21:30:00Z"],
      ["break", "2026-10-20T21:30:00Z", "2026-10-20T22:00:00Z"],
      ["working", "2026-10-20T22:00:00Z", "2026-10-21T00:30:00Z"],
    ])
      await tx.query(
        "INSERT INTO shift_intervals(id,shift_id,status,started_at,ended_at) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), shift, status, start, end],
      );
    for (const [at, units] of [
      ["2026-10-20T20:59:59.999Z", 10],
      ["2026-10-20T21:00:00Z", 20],
      ["2026-10-21T21:00:00Z", 30],
    ] as const)
      await tx.query(
        "INSERT INTO work_events(id,employee_id,employee_name,kind,occurred_at,shift_id,reference_id,reference_code,source_id,quantity,units) VALUES($1,$2,$3,'box_packed',$4,$5,$1,'BOUNDARY',$1,1,$6)",
        [randomUUID(), e.id, e.name, at, shift, units],
      );
  });
  const first = (
    await w.getPerformance({
      employeeId: e.id,
      from: "2026-10-20",
      to: "2026-10-20",
    })
  ).employees[0].metrics;
  assert.equal(first.workingSeconds, 1800);
  assert.equal(first.breakSeconds, 0);
  assert.equal(first.unitsPacked, 10);
  const second = (
    await w.getPerformance({
      employeeId: e.id,
      from: "2026-10-21",
      to: "2026-10-21",
    })
  ).employees[0];
  assert.equal(second.metrics.workingSeconds, 10800);
  assert.equal(second.metrics.breakSeconds, 1800);
  assert.equal(second.metrics.unitsPacked, 20);
  assert.equal(second.metrics.boxesPacked, 1);
  assert.equal(second.currentShift, null);
  const shifts = await w.getShiftHistory({
    employeeId: e.id,
    from: "2026-10-21",
    to: "2026-10-21",
  });
  assert.equal(shifts.items[0].startedAt, "2026-10-20T20:30:00.000Z");
  assert.equal(shifts.items[0].intervals[0].durationSeconds, 1800);
  assert.equal(shifts.items[0].workingSeconds, 10800);
  assert.equal(
    (
      await w.getWorkHistory({
        employeeId: e.id,
        from: "2026-10-21",
        to: "2026-10-21",
      })
    ).total,
    1,
  );
  assert.equal(
    (
      await w.getWorkHistory({
        employeeId: e.id,
        from: "2026-10-22",
        to: "2026-10-22",
      })
    ).items[0].units,
    30,
  );
  await assert.rejects(
    w.getPerformance({ from: "2026-02-31", to: "2026-03-01" }),
  );
  await assert.rejects(
    w.getPerformance({ from: "2026-10-22", to: "2026-10-21" }),
  );
  await assert.rejects(
    w.getPerformance({ from: "2024-01-01", to: "2025-01-01" }),
  );
  assert.equal(
    (await w.getPerformance({ from: "2024-01-01", to: "2024-12-31" })).from,
    "2024-01-01",
  );
});
