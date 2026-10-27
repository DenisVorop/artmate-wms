import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WarehouseService } from "../src/warehouse.service";
const restore = (name: string, value: string | undefined) =>
  value === undefined ? delete process.env[name] : (process.env[name] = value);
test("fresh production store is empty, migration is repeatable, and existing demo data is never cleared", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-production-init-"));
  const oldData = process.env.WMS_DATA_DIR,
    oldEnv = process.env.NODE_ENV;
  let warehouse: WarehouseService | undefined;
  try {
    process.env.NODE_ENV = "production";
    process.env.WMS_DATA_DIR = join(dir, "production");
    warehouse = new WarehouseService();
    await warehouse.onModuleInit();
    const first = await warehouse.snapshot();
    for (const key of [
      "skus",
      "locations",
      "pallets",
      "boxes",
      "lots",
      "employees",
      "tasks",
      "shipments",
      "receipts",
      "sections",
      "activities",
      "aisles",
      "entrances",
    ] as const)
      assert.deepEqual(first[key], [], key);
    assert.equal(first.balance.totalUnits, 0);
    assert.equal(first.warehouse.name, "Склад Artmate");
    const durable = () =>
      warehouse!.authTransaction(async (tx) => ({
        metadata: (await tx.query("SELECT * FROM metadata ORDER BY key")).rows,
        ledger: (await tx.query("SELECT * FROM stock_ledger ORDER BY id")).rows,
        commands: (await tx.query("SELECT * FROM commands ORDER BY request_id"))
          .rows,
      }));
    const before = await durable();
    await warehouse.onModuleDestroy();
    warehouse = undefined;
    warehouse = new WarehouseService();
    await warehouse.onModuleInit();
    assert.deepEqual(await warehouse.snapshot(), first);
    assert.deepEqual(await durable(), before);
    await warehouse.onModuleDestroy();
    warehouse = undefined;
    process.env.NODE_ENV = "test";
    process.env.WMS_DATA_DIR = join(dir, "existing");
    warehouse = new WarehouseService();
    await warehouse.onModuleInit();
    const existing = await warehouse.snapshot();
    assert.ok(existing.boxes.length > 0);
    await warehouse.onModuleDestroy();
    warehouse = undefined;
    process.env.NODE_ENV = "production";
    warehouse = new WarehouseService();
    await warehouse.onModuleInit();
    assert.deepEqual(await warehouse.snapshot(), existing);
  } finally {
    await warehouse?.onModuleDestroy();
    restore("NODE_ENV", oldEnv);
    restore("WMS_DATA_DIR", oldData);
    await rm(dir, { recursive: true, force: true });
  }
});
