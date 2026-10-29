import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WarehouseService } from "../src/warehouse.service";
import { WorkAutomationService } from "../src/work-automation/service";
import {
  automationOrigins,
  automationRuntime,
  saveAutomationOrigin,
} from "../src/work-automation/storage";
import type {
  MarketplacePlanDto,
  MarketplacePlanRowDto,
} from "../src/marketplaces/dto";
const req = () => ({ requestId: randomUUID() });
async function prepare(w: WarehouseService) {
  let state = await w.snapshot();
  const raw = state.pallets.find((pallet) => pallet.id === "pallet-raw-0")!;
  const low = state.locations.find(
    (location) => location.id === raw.locationId,
  )!;
  for (const level of [2, 3])
    state = await w.createRackLevel(low.sectionId!, {
      ...req(),
      code: `HIGH-${level}`,
      name: `Ярус ${level}`,
      maxHeightMm: 2200,
      maxBoxes: 42,
      availableWidthMm: 2000,
      availableDepthMm: 2000,
    });
  const high = state.locations.find(
    (location) => location.sectionId === low.sectionId && location.level === 3,
  )!;
  state = await w.createMovement({
    ...req(),
    palletId: raw.id,
    toLocationId: high.id,
    kind: "transfer",
    employeeId: "employee-3",
  });
  const move = state.movements.find(
    (movement) => movement.palletId === raw.id && movement.status === "planned",
  )!;
  await w.takeMovement(move.id, {
    ...req(),
    palletCode: raw.code,
    locationCode: low.code,
  });
  await w.placeMovement(move.id, {
    ...req(),
    palletCode: raw.code,
    locationCode: high.code,
  });
  return { raw, high, low };
}
test("automatic descent releases only untouched assembly reservations, works without a forecast, and resumes FIFO assembly after scans", async () => {
  const oldDir = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  const w = new WarehouseService();
  try {
    const { raw, high, low } = await prepare(w);
    await w.authTransaction(async (tx) => {
      const state = await w.stocktakeState(tx);
      await w.applyAutomaticTasks(tx, state, [
        {
          kind: "create",
          skuId: raw.skuId!,
          boxesTarget: 1,
          purpose: "urgent",
          proposalHash: "old-plan",
        },
      ]);
      const task = state.tasks.find((task) => task.autoPurpose)!;
      await saveAutomationOrigin(tx, {
        taskId: task.id,
        skuId: task.skuId,
        purpose: "urgent",
        proposalHash: "old-plan",
        boxesTarget: 1,
        createdAt: "2026-10-29T10:00:00Z",
        updatedAt: "2026-10-29T10:00:00Z",
        status: "queued",
        withdrawnAt: null,
        withdrawnReason: null,
        withdrawnTask: null,
      });
    });
    const before = await w.snapshot();
    let current = false;
    const service = () =>
      WorkAutomationService.forTesting(w, {
        forecast: async () => ({
          key: "test",
          cacheCurrent: current,
          goals: {},
          minimumBoxes: {},
        }),
        plan: () =>
          ({
            rows: [
              {
                skuId: raw.skuId!,
                skuName: "Котики-2",
                unitsPerBox: 20,
                averageDailyUnits: 10,
                localAfterAssemblyUnits: 0,
                recommendedBoxes: 1,
                recommendedUnits: 20,
                rawAvailableUnits: 1000,
                canCreate: true,
                dataComplete: true,
                backlogCapacityKnown: true,
                backlogCanCreate: false,
                backlogRank: 1,
                unregisteredUnits: 0,
                stockEstimated: false,
                proposalHash: "new-plan",
                providers: [],
                blockers: [],
              } as unknown as MarketplacePlanRowDto,
            ],
          }) as MarketplacePlanDto,
      });
    const raced = await Promise.all([
      service().runWorkAutomation(),
      service().runWorkAutomation(),
    ]);
    assert.equal(raced.filter((result) => result === "updated").length, 1);
    const after = await w.snapshot();
    const moves = after.movements.filter(
      (movement) =>
        movement.autoPurpose === "accessible_raw" &&
        movement.status === "planned",
    );
    assert.equal(moves.length, 1);
    assert.equal(moves[0].employeeId, null);
    assert.equal(moves[0].palletId, raw.id);
    assert.equal(moves[0].toLocationId, low.id);
    assert.deepEqual(after.pallets, before.pallets);
    assert.deepEqual(after.boxes, before.boxes);
    assert.deepEqual(after.balance, before.balance);
    assert.equal(after.tasks.length, 0);
    const origins = await w.authTransaction((tx) => automationOrigins(tx));
    assert.equal(origins.length, 1);
    assert.equal(origins[0].status, "withdrawn");
    assert.equal(origins[0].withdrawnTask!.reservations[0].palletId, raw.id);
    assert.match(origins[0].withdrawnReason!, /спустите/);
    assert.match(
      (await w.authTransaction((tx) => automationRuntime(tx))).message,
      /спустить сырьё/,
    );
    current = true;
    assert.equal(
      await service().runWorkAutomation(),
      "skipped",
      "fresh sales must not allocate younger stock during descent",
    );
    assert.equal((await w.snapshot()).tasks.length, 0);
    await w.claimMovement(moves[0].id, { ...req(), employeeId: "employee-1" });
    await w.takeMovement(moves[0].id, {
      ...req(),
      palletCode: raw.code,
      locationCode: high.code,
    });
    assert.equal(await service().runWorkAutomation(), "skipped");
    await w.placeMovement(moves[0].id, {
      ...req(),
      palletCode: raw.code,
      locationCode: low.code,
    });
    assert.equal(await service().runWorkAutomation(), "updated");
    const resumed = await w.snapshot();
    const task = resumed.tasks.find((task) => task.autoPurpose)!;
    assert.equal(task.skuId, raw.skuId);
    assert.equal(task.reservations[0].palletId, raw.id);
    assert.equal(
      resumed.pallets.find((pallet) => pallet.id === raw.id)!.locationId,
      low.id,
    );
    assert.equal(
      resumed.movements.filter(
        (movement) =>
          movement.autoPurpose === "accessible_raw" &&
          movement.status !== "completed",
      ).length,
      0,
    );
  } finally {
    await w.onModuleDestroy();
    if (oldDir === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = oldDir;
  }
});
test("manual or claimed assembly keeps its source and is not displaced by automatic descent", async () => {
  const oldDir = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  const w = new WarehouseService();
  try {
    const { raw } = await prepare(w);
    const before = await w.createTask({
      ...req(),
      skuId: raw.skuId!,
      boxesTarget: 1,
      employeeId: "employee-1",
    });
    const service = WorkAutomationService.forTesting(w, {
      forecast: async () => ({
        key: "pending",
        cacheCurrent: false,
        goals: {},
        minimumBoxes: {},
      }),
    });
    assert.equal(await service.runWorkAutomation(), "skipped");
    const after = await w.snapshot();
    assert.deepEqual(after.tasks, before.tasks);
    assert.deepEqual(after.pallets, before.pallets);
    assert.equal(
      after.movements.filter((movement) => movement.autoPurpose).length,
      0,
    );
  } finally {
    await w.onModuleDestroy();
    if (oldDir === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = oldDir;
  }
});

test("equal-age raw stock is reserved from accessible tiers before high pallets, without bypassing an older lot", async () => {
  const oldDir = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  const w = new WarehouseService();
  try {
    const { raw, low } = await prepare(w);
    let state = await w.snapshot();
    const date = state.lots.find((lot) => lot.id === raw.lotId)!.receivedAt;
    state = await w.createReceipt({
      ...req(),
      receivedAt: date,
      pallets: [{ skuId: raw.skuId!, quantity: 100, heightMm: 720 }],
    });
    const receipt = state.receipts[state.receipts.length - 1];
    const incoming = state.pallets.find(
      (pallet) => pallet.id === receipt.pallets[0].palletId,
    )!;
    await w.placeReceiptPallet(receipt.id, incoming.id, {
      ...req(),
      employeeId: "employee-3",
      palletCode: incoming.code,
      locationCode: low.code,
    });
    state = await w.createTask({ ...req(), skuId: raw.skuId!, boxesTarget: 1 });
    assert.equal(
      state.tasks[state.tasks.length - 1].reservations[0].palletId,
      incoming.id,
      "the accessible equal-date lot should be picked by hand first",
    );
  } finally {
    await w.onModuleDestroy();
    if (oldDir === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = oldDir;
  }
});
