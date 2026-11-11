import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { put } from "../src/marketplaces/storage";
import { WarehouseService } from "../src/warehouse.service";

const req = () => ({ requestId: randomUUID() });

test("one assembly accepts the current, old marketplace and manual barcodes, and rejects another theme or an ambiguous code", async () => {
  process.env.WMS_DATA_DIR = "memory://";
  const warehouse = new WarehouseService();
  const skuId = "sku-space";
  const employeeId = "employee-1";
  const oldCode = "2058301152261";
  const manualCode = "2000000000009";
  const ambiguousCode = "2000000000016";
  const multipackCode = "2000000000023";

  try {
    const initial = await warehouse.snapshot();
    const sku = initial.skus.find((item) => item.id === skuId)!;
    const other = initial.skus.find((item) => item.id !== skuId)!;
    const save = (alternateBarcodes: string[]) =>
      warehouse.updateSkuBarcodes(skuId, { ...req(), alternateBarcodes });
    await warehouse.authTransaction(async (tx) => {
      await put(tx, "marketplace_connections", "wildberries", {
        enabled: true,
        version: 7,
        lastSuccessVersion: 7,
        syncStatus: "failed",
      });
      await put(tx, "marketplace_snapshots", "wildberries", {
        products: [
          { externalId: "old", barcodes: [oldCode, ambiguousCode] },
          { externalId: "other", barcodes: [ambiguousCode] },
          { externalId: "multi", barcodes: [multipackCode] },
        ],
      });
      for (const [externalId, owner, unitsPerItem] of [
        ["old", skuId, 1],
        ["other", other.id, 1],
        ["multi", skuId, 2],
      ]) {
        await put(tx, "marketplace_mappings", String(externalId), {
          provider: "wildberries",
          externalId,
          skuId: owner,
          unitsPerItem,
        });
      }
    });
    await assert.rejects(save([other.barcode]), /уже принадлежит/);
    await assert.rejects(save([ambiguousCode]), /уже связан/);
    const saved = await save([manualCode, manualCode, sku.barcode]);
    assert.deepEqual(
      saved.skus.find((item) => item.id === skuId)?.alternateBarcodes,
      [manualCode],
    );
    await assert.rejects(
      warehouse.createSku({
        ...req(),
        name: "Другая тематика",
        barcode: manualCode,
      }),
      /Штрихкод уже принадлежит/,
    );

    const queued = await warehouse.createTask({
      ...req(),
      skuId,
      employeeId,
      boxesTarget: 1,
    });
    const task = queued.tasks[0];
    const pallet = queued.pallets.find(
      (item) => item.id === task.reservations[0].palletId,
    )!;
    await warehouse.claimTask(task.id, { ...req(), employeeId });
    await warehouse.scanTask(task.id, {
      ...req(),
      employeeId,
      kind: "source",
      value: pallet.code,
    });
    await warehouse.scanTask(task.id, {
      ...req(),
      employeeId,
      kind: "box",
      value: task.openBoxCode,
    });
    const scan = (value: string) =>
      warehouse.scanTask(task.id, {
        ...req(),
        employeeId,
        kind: "barcode",
        value,
      });

    for (const invalid of [other.barcode, ambiguousCode, multipackCode])
      await assert.rejects(scan(invalid), /Неверная тематика/);
    await scan(sku.barcode);
    await scan(oldCode);
    const mixed = await scan(manualCode);
    assert.equal(mixed.tasks[0].scannedUnits, 3);
    assert.equal(mixed.balance.rawUnits, initial.balance.rawUnits - 3);

    await warehouse.authTransaction(async (tx) => {
      await put(tx, "marketplace_connections", "wildberries", {
        enabled: true,
        version: 8,
        lastSuccessVersion: 7,
      });
    });
    await assert.rejects(scan(oldCode), /Неверная тематика/);
    const retained = await scan(manualCode);
    assert.equal(retained.tasks[0].scannedUnits, 4);
  } finally {
    await warehouse.onModuleDestroy();
  }
});
