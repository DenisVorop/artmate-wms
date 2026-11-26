import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { WarehouseService } from "../src/warehouse.service";
import {
  assemblyMetrics,
  DEMO_PACKAGING,
  DEFAULT_PACKAGING,
  finishedMetrics,
} from "../src/physical";
import { WorkAutomationService } from "../src/work-automation/service";
import { assemblyPressure } from "../src/work-automation/assembly-pressure";
import { automationRuntime } from "../src/work-automation/storage";
import type {
  MarketplacePlanDto,
  MarketplacePlanRowDto,
} from "../src/marketplaces/dto";

const req = () => ({ requestId: randomUUID() });

test("loaded legacy base resumes automatic single-box work and preserves scans, replay and putaway accounting", async () => {
  const previousDir = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  const w = new WarehouseService();
  try {
    await w.snapshot();
    // Isolated fixture: rearrange 36 existing seed boxes without adding stock.
    await w.authTransaction(async (tx) => {
      const state = await w.stocktakeState(tx);
      const location = state.locations.find(
        (item) => item.id === "loc-assembly",
      )!;
      Object.assign(location, {
        maxBoxes: 42,
        maxHeightMm: 2200,
        availableWidthMm: 1200,
        availableDepthMm: 900,
      });
      for (const storage of state.locations.filter((item) =>
        ["loc-10", "loc-11", "loc-12"].includes(item.id),
      )) {
        Object.assign(storage, {
          maxBoxes: 42,
          maxHeightMm: 2200,
          availableWidthMm: 1200,
          availableDepthMm: 900,
        });
        await tx.query("UPDATE locations SET payload=$2 WHERE id=$1", [
          storage.id,
          JSON.stringify(storage),
        ]);
      }
      const boxes = state.boxes.slice(0, 36);
      const ids = new Set(boxes.map((box) => box.id));
      for (const pallet of state.pallets.filter(
        (item) => item.kind === "finished",
      )) {
        pallet.quantity = state.boxes.filter(
          (box) => box.palletId === pallet.id && !ids.has(box.id),
        ).length;
        Object.assign(
          pallet,
          finishedMetrics(pallet.packagingSnapshot!, pallet.quantity),
        );
        await tx.query("UPDATE pallets SET payload=$2 WHERE id=$1", [
          pallet.id,
          JSON.stringify(pallet),
        ]);
      }
      for (const box of boxes) {
        Object.assign(box, {
          locationId: location.id,
          palletId: "legacy-assembly",
          packagingSnapshot: { ...DEFAULT_PACKAGING },
        });
        await tx.query("UPDATE boxes SET payload=$2 WHERE id=$1", [
          box.id,
          JSON.stringify(box),
        ]);
      }
      const pallet = {
        id: "legacy-assembly",
        code: "ASM-LEGACY",
        kind: "assembly",
        status: "stored",
        skuId: null,
        lotId: null,
        locationId: location.id,
        returnLocationId: null,
        packagingSnapshot: { ...DEMO_PACKAGING },
        ...assemblyMetrics(
          DEMO_PACKAGING,
          boxes.map((box) => box.packagingSnapshot),
        ),
      };
      await tx.query("INSERT INTO pallets(id,payload) VALUES($1,$2)", [
        pallet.id,
        JSON.stringify(pallet),
      ]);
      await tx.query("UPDATE locations SET payload=$2 WHERE id=$1", [
        location.id,
        JSON.stringify(location),
      ]);
      const sku = state.skus.find((item) => item.id === "sku-space")!;
      sku.packaging = { ...DEFAULT_PACKAGING };
      await tx.query("UPDATE skus SET payload=$2 WHERE id=$1", [
        sku.id,
        JSON.stringify(sku),
      ]);
    });
    const before = await w.snapshot();
    const service = WorkAutomationService.forTesting(w, {
      forecast: async () => ({
        key: "current",
        cacheCurrent: true,
        goals: {},
        minimumBoxes: {},
      }),
      plan: () =>
        ({
          rows: [
            {
              skuId: "sku-space",
              skuName: "Космос",
              unitsPerBox: 20,
              averageDailyUnits: 10,
              localAfterAssemblyUnits: 0,
              recommendedBoxes: 3,
              recommendedUnits: 60,
              rawAvailableUnits: 520,
              canCreate: true,
              dataComplete: true,
              backlogCapacityKnown: true,
              backlogCanCreate: false,
              backlogRank: 1,
              unregisteredUnits: 0,
              stockEstimated: false,
              proposalHash: "current",
              providers: [],
              blockers: [],
            } as unknown as MarketplacePlanRowDto,
          ],
        }) as MarketplacePlanDto,
    });
    assert.equal(assemblyPressure(before).capacityBoxes, 42);
    assert.equal(assemblyPressure(before).level, "near_full");
    await service.runWorkAutomation();
    let state = await w.snapshot();
    const queued = state.tasks.filter((task) => task.autoPurpose);
    assert.equal(
      queued.length,
      3,
      JSON.stringify(await w.authTransaction(automationRuntime)),
    );
    assert.ok(
      queued.every(
        (task) =>
          task.boxesTarget === 1 &&
          task.status === "queued" &&
          task.employeeId === null,
      ),
    );
    assert.deepEqual(state.boxes, before.boxes);
    assert.deepEqual(state.pallets, before.pallets);
    const first = queued[0];
    await w.claimTask(first.id, { ...req(), employeeId: "employee-1" });
    const source = state.pallets.find(
      (pallet) => pallet.id === first.reservations[0].palletId,
    )!;
    await w.scanTask(first.id, {
      ...req(),
      employeeId: "employee-1",
      kind: "source",
      value: source.code,
    });
    await w.scanTask(first.id, {
      ...req(),
      employeeId: "employee-1",
      kind: "box",
      value: first.openBoxCode,
    });
    const barcode = state.skus.find((sku) => sku.id === first.skuId)!.barcode;
    for (let index = 0; index < 19; index++)
      await w.scanTask(first.id, {
        ...req(),
        employeeId: "employee-1",
        kind: "barcode",
        value: barcode,
      });
    const final = {
      ...req(),
      employeeId: "employee-1",
      kind: "barcode" as const,
      value: barcode,
    };
    state = await w.scanTask(first.id, final);
    assert.equal(
      state.tasks.find((task) => task.id === first.id)!.status,
      "completed",
    );
    assert.equal(assemblyPressure(state).boxes, 37);
    assert.equal(state.balance.totalUnits, before.balance.totalUnits);
    assert.deepEqual(await w.scanTask(first.id, final), state);
    const packed = state.boxes.find((box) => box.code === first.openBoxCode)!;
    const putaway = state.putawayTasks.find(
      (task) => task.boxId === packed.id,
    )!;
    await w.claimPutawayTask(putaway.id, {
      ...req(),
      employeeId: "employee-3",
    });
    state = await w.takePutawayBox(putaway.id, {
      ...req(),
      employeeId: "employee-3",
      boxCode: packed.code,
    });
    assert.equal(assemblyPressure(state).boxes, 36);
    assert.equal(assemblyPressure(state).capacityBoxes, 42);
    assert.equal(
      state.boxes.find((box) => box.id === packed.id)!.status,
      "in_transit",
    );
    assert.equal(state.balance.totalUnits, before.balance.totalUnits);
    assert.deepEqual(
      state.pallets.find((pallet) => pallet.id === "legacy-assembly")!
        .packagingSnapshot,
      DEMO_PACKAGING,
    );
  } finally {
    await w.onModuleDestroy();
    if (previousDir === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previousDir;
  }
});
