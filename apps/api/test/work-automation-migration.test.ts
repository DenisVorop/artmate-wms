import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WarehouseService } from "../src/warehouse.service";

test("schema18 creates only automation storage and preserves warehouse, revisions, facts, labels, auth and replies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-auto-migration-"));
  const old = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = join(dir, "db");
  let w = new WarehouseService();
  const tables = [
    "pallets",
    "boxes",
    "tasks",
    "locations",
    "receipts",
    "putaway_tasks",
    "employees",
    "commands",
    "auth_accounts",
    "auth_sessions",
    "stock_ledger_events",
    "work_events",
    "box_label_batches",
    "box_labels",
  ];
  try {
    const baseline = await w.snapshot();
    const capture = () =>
      w.authTransaction(async (tx) => {
        const names = (
          await tx.query<{ tablename: string }>(
            "SELECT tablename FROM pg_tables WHERE schemaname='public'",
          )
        ).rows.map((x) => x.tablename);
        const values: Record<string, unknown> = {};
        for (const name of names.filter((name) => tables.includes(name)))
          values[name] = (
            await tx.query(`SELECT * FROM ${name} ORDER BY 1`)
          ).rows;
        values.metadata = (
          await tx.query(
            "SELECT * FROM metadata WHERE key<>'schema_version' ORDER BY key",
          )
        ).rows;
        return values;
      });
    const before = await capture();
    await w.authTransaction(async (tx) => {
      for (const table of [
        "automation_commands",
        "automation_tasks",
        "automation_settings",
      ])
        await tx.query(`DROP TABLE ${table}`);
      await tx.query(
        "UPDATE metadata SET value='17' WHERE key='schema_version'",
      );
    });
    await w.onModuleDestroy();
    w = new WarehouseService();
    assert.deepEqual(await w.snapshot(), baseline);
    assert.deepEqual(await capture(), before);
    await w.authTransaction(async (tx) => {
      assert.equal(
        (
          await tx.query<{ value: string }>(
            "SELECT value FROM metadata WHERE key='schema_version'",
          )
        ).rows[0].value,
        "18",
      );
      for (const name of [
        "automation_commands",
        "automation_tasks",
        "automation_settings",
      ])
        assert.equal((await tx.query(`SELECT * FROM ${name}`)).rows.length, 0);
    });
    await w.onModuleDestroy();
    w = new WarehouseService();
    assert.deepEqual(await w.snapshot(), baseline);
    assert.deepEqual(await capture(), before);
  } finally {
    await w.onModuleDestroy();
    if (old === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = old;
    await rm(dir, { recursive: true, force: true });
  }
});
