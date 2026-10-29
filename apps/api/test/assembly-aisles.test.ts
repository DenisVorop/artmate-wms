import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WarehouseService } from "../src/warehouse.service";
const req = () => ({ requestId: randomUUID() });

test("assembly pallet can move onto an aisle and keep its identity; ordinary storage and collisions remain protected", async () => {
  const previous = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  const w = new WarehouseService();
  try {
    await w.updateWarehousePlan({ ...req(), width: 100, depth: 100 });
    const initial = await w.snapshot();
    const pack = initial.locations.find((l) => l.code === "PACK-01")!;
    const label = await w.getLabel("location", pack.id);
    let s = await w.createAisle({
      ...req(),
      name: "Рабочий проход",
      x: 60,
      y: 60,
      width: 6,
      depth: 4,
    });
    const aisle = s.aisles.at(-1)!;
    const move = { ...req(), x: 61, y: 61 };
    s = await w.updateLocation(pack.id, move);
    assert.equal(s.locations.find((l) => l.id === pack.id)!.code, pack.code);
    assert.deepEqual(await w.getLabel("location", pack.id), label);
    for (const key of [
      "pallets",
      "boxes",
      "lots",
      "tasks",
      "putawayTasks",
      "receipts",
      "shipments",
    ] as const)
      assert.deepEqual(s[key], initial[key], key);
    assert.deepEqual(
      await w.updateLocation(pack.id, move),
      s,
      "same command replays once",
    );
    s = await w.updateAisle(aisle.id, { ...req(), width: 7 });
    await w.deleteAisle(aisle.id, req());
    s = await w.restoreAisle(aisle.id, req());
    assert.equal(s.aisles.find((a) => a.id === aisle.id)!.archived, false);
    const body = {
      ...req(),
      code: "PACK-TEST",
      name: "Дополнительная сборка",
      kind: "assembly",
      x: 65,
      y: 60,
      width: 1,
      depth: 1,
      levels: 1,
      maxHeightMm: 2000,
      maxBoxes: 18,
      availableWidthMm: 1200,
      availableDepthMm: 800,
    };
    s = await w.createLocation(body);
    const extra = s.locations.find((l) => l.code === body.code)!;
    await w.deleteLocation(extra.id, req());
    s = await w.restoreLocation(extra.id, req());
    const unchanged = await w.snapshot();
    await assert.rejects(
      w.updateLocation(extra.id, { ...req(), kind: "floor" }),
      /пересекается/,
    );
    assert.deepEqual(
      await w.snapshot(),
      unchanged,
      "changing kind must revalidate geometry atomically",
    );
    await assert.rejects(
      w.createLocation({
        ...body,
        ...req(),
        code: "FLOOR-TEST",
        kind: "floor",
        x: 60,
        y: 60,
      }),
      /пересекается/,
    );
    await assert.rejects(
      w.updateLocation(extra.id, { ...req(), x: 61, y: 61 }),
      /пересекается/,
    );
    await assert.rejects(
      w.updateLocation(pack.id, { ...req(), x: 100 }),
      /границы/,
    );
    const rack = s.sections.find((r) => !r.archived)!;
    await assert.rejects(
      w.updateLocation(pack.id, { ...req(), x: rack.x, y: rack.y }),
      /пересекается/,
    );
    await assert.rejects(
      w.updateRackSection(rack.id, { ...req(), x: 60, y: 60 }),
      /пересекается/,
    );
    assert.deepEqual(
      await w.snapshot(),
      unchanged,
      "rejected moves do not alter stock or layout",
    );
  } finally {
    await w.onModuleDestroy();
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
  }
});
