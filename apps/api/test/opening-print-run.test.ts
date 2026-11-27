import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { WarehouseService } from "../src/warehouse.service";
import { StocktakeService } from "../src/stocktake.service";
import { requestAuth } from "../src/auth-context";
import { samePrintRun } from "../src/print-run";
import type * as D from "../src/dto";

const req = () => ({ requestId: randomUUID() });
const as = <T>(role: string, action: () => T) =>
  requestAuth.run(
    {
      http: true,
      tokenHash: `opening-run-${role}`,
      csrfToken: `csrf-${role}`,
      origin: "http://127.0.0.1:3080",
    },
    action,
  );

test("separate approved opening inventories share storage and WB picking; a new receipt stays separate with FIFO and quantities intact", async () => {
  const previous = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  const w = new WarehouseService();
  try {
    await w.updateWarehousePlan({ ...req(), width: 200, depth: 200 });
    await w.authTransaction(async (tx) => {
      for (const [id, employee, role] of [
        ["manager", "employee-3", "manager"],
        ["worker", "employee-1", "employee"],
      ]) {
        await tx.query(
          "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES($1,$2,$1,'test-only',$3,FALSE)",
          [id, employee, role],
        );
        await tx.query(
          "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES($1,$1,$2,$3,NOW()+INTERVAL '1 hour')",
          [id, `opening-run-${id}`, `csrf-${id}`],
        );
      }
    });
    let state = await w.snapshot();
    const priorSku = new Set(state.skus.map((s) => s.id));
    state = await w.createSku({
      ...req(),
      name: "Opening print run",
      barcode: "4699999999928",
    });
    const sku = state.skus.find((s) => !priorSku.has(s.id))!;
    const addresses: D.LocationDto[] = [];
    for (let i = 0; i < 2; i++) {
      const code = `OPENING-RUN-${i}`;
      state = await w.createLocation({
        ...req(),
        code,
        name: code,
        kind: "floor",
        x: 40 + i * 3,
        y: 40,
        width: 2,
        depth: 2,
        levels: 1,
        availableWidthMm: 1200,
        availableDepthMm: 900,
        maxHeightMm: 2500,
        maxBoxes: 42,
        maxWeightKg: null,
        accessSides: 4,
      });
      addresses.push(state.locations.find((l) => l.code === code)!);
    }
    const stocktakes = new StocktakeService(w);
    const documents: string[] = [];
    for (let i = 0; i < 2; i++) {
      const location = addresses[i];
      let doc = await as("manager", () =>
        stocktakes.createStocktake({
          ...req(),
          mode: "opening",
          locationIds: [location.id],
        }),
      );
      documents.push(doc.id);
      doc = await as("worker", () =>
        stocktakes.claimStocktake(doc.id, {
          ...req(),
          expectedRevision: doc.revision,
        }),
      );
      const openingPallet: D.OpeningPalletCountDto =
        i === 0
          ? {
              kind: "raw",
              skuId: sku.id,
              heightMm: 500,
              batches: [{ receivedAt: "2026-11-07T09:00:00Z", quantity: 20 }],
            }
          : {
              kind: "finished",
              skuId: sku.id,
              unitsPerBox: 20,
              batches: [{ receivedAt: "2026-11-06T09:00:00Z", quantity: 2 }],
            };
      doc = await as("worker", () =>
        stocktakes.countStocktakeLocation(doc.id, location.id, {
          ...req(),
          expectedRevision: doc.revision,
          locationCode: location.code,
          rawPallets: [],
          boxCodes: [],
          openingPallet,
        }),
      );
      doc = await as("worker", () =>
        stocktakes.submitStocktake(doc.id, {
          ...req(),
          expectedRevision: doc.revision,
        }),
      );
      await as("manager", () =>
        stocktakes.approveStocktake(doc.id, {
          ...req(),
          expectedRevision: doc.revision,
          reason: "Подтверждён начальный остаток",
        }),
      );
    }
    state = await w.snapshot();
    const lots = structuredClone(state.lots);
    const initialBoxes = state.boxes.filter((b) => b.skuId === sku.id);
    const raw = state.pallets.find(
      (p) => p.skuId === sku.id && p.kind === "raw",
    )!;
    assert.notEqual(raw.lotId, initialBoxes[0].lotContents[0].lotId);
    assert.equal(
      samePrintRun(state, raw.lotId!, initialBoxes[0].lotContents[0].lotId),
      true,
    );
    const total = state.balance.totalUnits;
    const oldTasks = new Set(state.tasks.map((t) => t.id));
    state = await w.createTask({ ...req(), skuId: sku.id, boxesTarget: 1 });
    const task = state.tasks.find((t) => !oldTasks.has(t.id))!;
    await w.claimTask(task.id, { ...req(), employeeId: "employee-1" });
    await w.scanTask(task.id, {
      ...req(),
      employeeId: "employee-1",
      kind: "source",
      value: raw.code,
    });
    await w.scanTask(task.id, {
      ...req(),
      employeeId: "employee-1",
      kind: "box",
      value: task.openBoxCode,
    });
    for (let n = 0; n < 20; n++)
      state = await w.scanTask(task.id, {
        ...req(),
        employeeId: "employee-1",
        kind: "barcode",
        value: sku.barcode,
      });
    const box = state.boxes.find((b) => b.code === task.openBoxCode)!;
    const putaway = state.putawayTasks.find((t) => t.boxId === box.id)!;
    const contents = structuredClone(box.lotContents);
    const options = await w.getPutawayPlacementOptions(putaway.id);
    assert.equal(
      options.suggestedLocationId,
      addresses[1].id,
      "prefer starting stock counted in a different document despite its different lot and date",
    );
    await w.claimPutawayTask(putaway.id, {
      ...req(),
      employeeId: "employee-1",
    });
    await w.takePutawayBox(putaway.id, {
      ...req(),
      employeeId: "employee-1",
      boxCode: box.code,
    });
    const place = {
      ...req(),
      employeeId: "employee-1",
      locationCode: addresses[1].code,
    };
    state = await w.placePutawayBox(putaway.id, place);
    assert.deepEqual(await w.placePutawayBox(putaway.id, place), state);
    assert.equal(
      state.pallets.find((p) => p.locationId === addresses[1].id)!.quantity,
      3,
    );
    assert.equal(state.balance.totalUnits, total);
    assert.deepEqual(state.lots, lots);
    assert.deepEqual(
      state.boxes.find((b) => b.id === box.id)!.lotContents,
      contents,
    );
    state = await w.importWbShipment(
      { ...req(), supplyId: "opening-run", sourceShipmentIds: [] },
      async () => ({
        storeId: "test",
        labels: [
          { id: "one", code: "$Wb;opening-run;TAS", skuId: sku.id, units: 20 },
        ],
      }),
    );
    const shipment = state.shipments.find(
      (s) => s.wb?.supplyId === "opening-run",
    )!;
    // FIFO reserves an older finished box; the newer packed box is interchangeable
    // within this same starting print run and physical pallet.
    assert.notEqual(shipment.boxIds[0], box.id);
    await w.claimShipmentWork(shipment.id, {
      ...req(),
      employeeId: "employee-1",
    });
    await w.scanShipmentWork(shipment.id, {
      ...req(),
      employeeId: "employee-1",
      boxCode: addresses[1].code,
    });
    state = await w.scanShipmentWork(shipment.id, {
      ...req(),
      employeeId: "employee-1",
      boxCode: box.code,
    });
    assert.equal(
      state.shipments.find((s) => s.id === shipment.id)!.wb!.pendingBoxId,
      box.id,
    );
    const label = {
      ...req(),
      employeeId: "employee-1",
      boxCode: "$Wb;opening-run;TAS",
    };
    state = await w.scanShipmentWork(shipment.id, label);
    assert.deepEqual(await w.scanShipmentWork(shipment.id, label), state);
    assert.equal(state.balance.totalUnits, total);
    assert.deepEqual(state.lots, lots);
    assert.deepEqual(
      state.boxes.find((b) => b.id === box.id)!.lotContents,
      contents,
    );
    state = await w.createReceipt({
      ...req(),
      receivedAt: "2026-11-07T09:00:00Z",
      pallets: [{ skuId: sku.id, quantity: 20, heightMm: 500 }],
    });
    const newLot = state.lots.find(
      (l) => l.skuId === sku.id && !lots.some((old) => old.id === l.id),
    )!;
    assert.equal(newLot.openingStocktakeId, undefined);
    assert.equal(samePrintRun(state, raw.lotId!, newLot.id), false);
    assert.equal(
      state.balance.totalUnits,
      total,
      "pending new receipt is not on-hand stock",
    );
    for (const original of lots)
      assert.deepEqual(
        state.lots.find((l) => l.id === original.id),
        original,
      );
    for (const id of documents)
      assert.equal(
        (await as("manager", () => stocktakes.getStocktake(id))).status,
        "approved",
      );
  } finally {
    await w.onModuleDestroy();
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
  }
});
