import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ConsumableItem } from "../src/dto";
import { WarehouseService } from "../src/warehouse.service";

const req = () => ({ requestId: randomUUID() });

test("assembly reserves from actual addresses and writes off one kit once", async () => {
  process.env.WMS_DATA_DIR = "memory://";
  const warehouse = new WarehouseService();
  const count = (
    locationId: string,
    item: ConsumableItem,
    quantity: number,
    expectedQuantity = 0,
  ) =>
    warehouse.changeConsumables(locationId, {
      ...req(),
      item,
      quantity,
      expectedQuantity,
      mode: "count",
    });
  const create = () =>
    warehouse.createTask({
      ...req(),
      skuId: "sku-space",
      boxesTarget: 1,
      employeeId: "employee-1",
    });

  try {
    const queued = (await create()).tasks[0];
    assert.equal(queued.consumableReservations, undefined);
    await assert.rejects(
      warehouse.enableConsumables(req()),
      /Не хватает упаковки/,
    );
    assert.equal(
      (await warehouse.snapshot()).warehouse.consumablesEnabled,
      undefined,
    );
    await assert.rejects(
      count("loc-2", "individual_box", 5),
      /физически стоит паллета/,
    );
    await count("loc-10", "individual_box", 8);
    await count("loc-11", "individual_box", 12);
    await count("loc-12", "transport_carton", 1);
    await assert.rejects(warehouse.deleteLocation("loc-10", req()), /упаковки/);
    await assert.rejects(
      warehouse.createMovement({
        ...req(),
        palletId: "pallet-cats-new",
        toLocationId: "loc-10",
        kind: "transfer",
        employeeId: "employee-1",
      }),
      /упаковка/,
    );

    const enabled = await warehouse.enableConsumables(req());
    assert.deepEqual(enabled.tasks[0].consumableReservations, [
      { item: "individual_box", locationId: "loc-10", quantity: 8 },
      { item: "individual_box", locationId: "loc-11", quantity: 12 },
      { item: "transport_carton", locationId: "loc-12", quantity: 1 },
    ]);
    await assert.rejects(create(), /Не хватает упаковки/);
    await assert.rejects(
      count("loc-11", "individual_box", 11, 12),
      /зарезервировано 12/,
    );
    await assert.rejects(
      count("loc-11", "individual_box", 22),
      /Остаток изменился/,
    );
    const receive = {
      ...req(),
      item: "transport_carton",
      quantity: 5,
      expectedQuantity: 1,
      mode: "receive",
    } as const;
    const received = await warehouse.changeConsumables("loc-12", receive);
    assert.deepEqual(
      await warehouse.changeConsumables("loc-12", receive),
      received,
    );
    assert.equal(
      received.warehouse.consumables?.find((row) => row.locationId === "loc-12")
        ?.quantity,
      6,
    );

    const employeeId = "employee-1";
    const source = enabled.pallets.find(
      (pallet) => pallet.id === queued.reservations[0].palletId,
    )!;
    await warehouse.claimTask(queued.id, { ...req(), employeeId });
    await warehouse.scanTask(queued.id, {
      ...req(),
      employeeId,
      kind: "source",
      value: source.code,
    });
    await warehouse.scanTask(queued.id, {
      ...req(),
      employeeId,
      kind: "box",
      value: queued.openBoxCode,
    });
    const barcode = {
      employeeId,
      kind: "barcode",
      value: "4601234000028",
    } as const;
    for (let i = 1; i < 20; i++)
      await warehouse.scanTask(queued.id, { ...req(), ...barcode });
    assert.equal((await warehouse.snapshot()).warehouse.consumables?.length, 3);
    const final = { ...req(), ...barcode };
    const packed = await warehouse.scanTask(queued.id, final);
    assert.equal(packed.tasks[0].status, "completed");
    assert.deepEqual(packed.warehouse.consumables, [
      { item: "transport_carton", locationId: "loc-12", quantity: 5 },
    ]);
    assert.deepEqual(await warehouse.scanTask(queued.id, final), packed);
    assert.deepEqual(
      (await warehouse.snapshot()).warehouse.consumables,
      packed.warehouse.consumables,
    );
    await warehouse.deleteLocation("loc-10", req());
    await assert.rejects(create(), /Не хватает упаковки/);
  } finally {
    await warehouse.onModuleDestroy();
  }
});
