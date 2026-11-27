import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { WarehouseService } from "../src/warehouse.service";
import { samePrintRun } from "../src/print-run";

const req = () => ({ requestId: randomUUID() });

test("a receipt creates one lot per SKU across pallets; another receipt stays separate and replay never duplicates it", async () => {
  const previousDir = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  const w = new WarehouseService();
  try {
    const before = await w.snapshot();
    const body = {
      requestId: randomUUID(),
      receivedAt: "2026-11-16T14:32:00.000Z",
      pallets: [
        { skuId: "sku-cats", quantity: 800 },
        { skuId: "sku-cats", quantity: 840 },
        { skuId: "sku-space", quantity: 200 },
      ],
    };
    const state = await w.createReceipt(body);
    const receipt = state.receipts.find(
      (r) => !before.receipts.some((old) => old.id === r.id),
    )!;
    const pallets = receipt.pallets.map(
      (row) => state.pallets.find((p) => p.id === row.palletId)!,
    );
    assert.equal(receipt.pallets.length, 3);
    assert.equal(new Set(pallets.map((p) => p.id)).size, 3);
    assert.equal(state.lots.length, before.lots.length + 2);
    assert.equal(pallets[0].lotId, pallets[1].lotId);
    assert.notEqual(pallets[0].lotId, pallets[2].lotId);
    assert.equal(
      samePrintRun(state, pallets[0].lotId!, pallets[1].lotId!),
      true,
    );
    assert.equal(state.balance.totalUnits, before.balance.totalUnits);
    assert.deepEqual(await w.createReceipt(body), state);
    const next = await w.createReceipt({
      ...body,
      requestId: randomUUID(),
      pallets: [{ skuId: "sku-cats", quantity: 20 }],
    });
    const otherReceipt = next.receipts.find(
      (r) => !state.receipts.some((old) => old.id === r.id),
    )!;
    const other = next.pallets.find(
      (p) => p.id === otherReceipt.pallets[0].palletId,
    )!;
    assert.notEqual(other.lotId, pallets[0].lotId);
    assert.equal(samePrintRun(next, other.lotId!, pallets[0].lotId!), false);
    for (const old of state.lots)
      assert.deepEqual(
        next.lots.find((lot) => lot.id === old.id),
        old,
      );
  } finally {
    await w.onModuleDestroy();
    if (previousDir === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previousDir;
  }
});

for (const legacy of [false, true])
  test(`${legacy ? "Legacy split" : "Shared"} receipt lots pack, consolidate, and substitute a WB box without rewriting lot contents or changing quantity`, async () => {
    const previousDir = process.env.WMS_DATA_DIR;
    process.env.WMS_DATA_DIR = "memory://";
    const w = new WarehouseService();
    try {
      let state = await w.snapshot();
      const beforeSku = new Set(state.skus.map((s) => s.id));
      state = await w.createSku({
        ...req(),
        name: "Receipt print run",
        barcode: "4699999999911",
      });
      const sku = state.skus.find((s) => !beforeSku.has(s.id))!;
      state = await w.createReceipt({
        ...req(),
        receivedAt: "2026-11-16T14:32:00.000Z",
        pallets: [
          { skuId: sku.id, quantity: 20, heightMm: 500 },
          { skuId: sku.id, quantity: 20, heightMm: 500 },
        ],
      });
      const receipt = state.receipts.at(-1)!;
      const sources = receipt.pallets.map(
        (row) => state.pallets.find((p) => p.id === row.palletId)!,
      );
      const originalLot = state.lots.find((l) => l.id === sources[0].lotId)!;
      // Simulate an old per-pallet lot split while receipt stock is still pending.
      // No on-hand quantity or ledger position exists for either source yet.
      if (legacy) {
        const alias = { ...originalLot, id: "legacy-source-lot" };
        await w.authTransaction(async (tx) => {
          await tx.query("INSERT INTO lots(id,payload) VALUES($1,$2)", [
            alias.id,
            JSON.stringify(alias),
          ]);
          await tx.query("UPDATE pallets SET payload=$2 WHERE id=$1", [
            sources[1].id,
            JSON.stringify({ ...sources[1], lotId: alias.id }),
          ]);
        });
      }
      const sourceLocations = ["loc-10", "loc-11"];
      for (let index = 0; index < sources.length; index++) {
        state = await w.placeReceiptPallet(receipt.id, sources[index].id, {
          ...req(),
          employeeId: "employee-1",
          palletCode: sources[index].code,
          locationCode: state.locations.find(
            (l) => l.id === sourceLocations[index],
          )!.code,
        });
      }
      const total = state.balance.totalUnits;
      const packedIds: string[] = [];
      let storedLocationId: string | null = null;
      for (let index = 0; index < 2; index++) {
        const priorTasks = new Set(state.tasks.map((t) => t.id));
        state = await w.createTask({ ...req(), skuId: sku.id, boxesTarget: 1 });
        const task = state.tasks.find((t) => !priorTasks.has(t.id))!;
        const source = state.pallets.find(
          (p) => p.id === task.reservations[0].palletId,
        )!;
        await w.claimTask(task.id, { ...req(), employeeId: "employee-1" });
        await w.scanTask(task.id, {
          ...req(),
          employeeId: "employee-1",
          kind: "source",
          value: source.code,
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
        packedIds.push(box.id);
        const putaway = state.putawayTasks.find((t) => t.boxId === box.id)!;
        const options = await w.getPutawayPlacementOptions(putaway.id);
        if (storedLocationId)
          assert.equal(options.suggestedLocationId, storedLocationId);
        else storedLocationId = options.suggestedLocationId;
        assert.ok(storedLocationId);
        await w.claimPutawayTask(putaway.id, {
          ...req(),
          employeeId: "employee-1",
        });
        await w.takePutawayBox(putaway.id, {
          ...req(),
          employeeId: "employee-1",
          boxCode: box.code,
        });
        state = await w.placePutawayBox(putaway.id, {
          ...req(),
          employeeId: "employee-1",
          locationCode: state.locations.find((l) => l.id === storedLocationId)!
            .code,
        });
        assert.equal(state.balance.totalUnits, total);
      }
      const packed = packedIds.map(
        (id) => state.boxes.find((b) => b.id === id)!,
      );
      assert.equal(
        new Set(packed.map((box) => box.lotContents[0].lotId)).size,
        legacy ? 2 : 1,
      );
      assert.equal(packed[0].palletId, packed[1].palletId);
      const originalContents = packed.map((b) =>
        structuredClone(b.lotContents),
      );
      state = await w.importWbShipment(
        { ...req(), supplyId: "receipt-run", sourceShipmentIds: [] },
        async () => ({
          storeId: "test",
          labels: [
            {
              id: "one",
              code: "$Wb;receipt-run;TAS",
              skuId: sku.id,
              units: 20,
            },
          ],
        }),
      );
      const shipment = state.shipments.find(
        (s) => s.wb?.supplyId === "receipt-run",
      )!;
      const alternative = packed.find((b) => b.id !== shipment.boxIds[0])!;
      await w.claimShipmentWork(shipment.id, {
        ...req(),
        employeeId: "employee-1",
      });
      await w.scanShipmentWork(shipment.id, {
        ...req(),
        employeeId: "employee-1",
        boxCode: state.locations.find((l) => l.id === storedLocationId)!.code,
      });
      state = await w.scanShipmentWork(shipment.id, {
        ...req(),
        employeeId: "employee-1",
        boxCode: alternative.code,
      });
      assert.equal(
        state.shipments.find((s) => s.id === shipment.id)!.wb!.pendingBoxId,
        alternative.id,
      );
      const labelScan = {
        ...req(),
        employeeId: "employee-1",
        boxCode: "$Wb;receipt-run;TAS",
      };
      state = await w.scanShipmentWork(shipment.id, labelScan);
      assert.equal(state.balance.totalUnits, total);
      assert.equal(
        state.boxes.find((b) => b.id === alternative.id)!.status,
        "staged",
      );
      assert.equal(
        state.shipments.find((s) => s.id === shipment.id)!.status,
        "draft",
      );
      assert.deepEqual(await w.scanShipmentWork(shipment.id, labelScan), state);
      for (let index = 0; index < packedIds.length; index++)
        assert.deepEqual(
          state.boxes.find((b) => b.id === packedIds[index])!.lotContents,
          originalContents[index],
        );
    } finally {
      await w.onModuleDestroy();
      if (previousDir === undefined) delete process.env.WMS_DATA_DIR;
      else process.env.WMS_DATA_DIR = previousDir;
    }
  });
