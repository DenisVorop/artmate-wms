import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { WarehouseService } from "../src/warehouse.service";
import { randomUUID } from "node:crypto";
test("schema11 is additive, preserves warehouse IDs/revision/all prior SQL histories/cache, creates no documents and restarts idempotently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-stocktake-migration-")),
    path = join(dir, "db"),
    previous = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = path;
  let w: WarehouseService | undefined;
  try {
    w = new WarehouseService();
    const command = {
        requestId: randomUUID(),
        name: "Склад до инвентаризации",
      },
      cached = await w.updateWarehousePlan(command),
      before = await w.snapshot();
    await w.onModuleDestroy();
    w = undefined;
    const db = new PGlite(path);
    await db.waitReady;
    await db.exec(
      "DROP TABLE stocktake_commands;DROP TABLE stocktake_history;DROP TABLE stocktake_rows;DROP TABLE stocktakes;DROP TABLE stocktake_cell_versions;UPDATE metadata SET value='10' WHERE key='schema_version'",
    );
    const names = [
      "skus",
      "locations",
      "lots",
      "pallets",
      "boxes",
      "tasks",
      "employees",
      "shipments",
      "activities",
      "sections",
      "movements",
      "aisles",
      "entrances",
      "receipts",
      "putawayTasks",
      "commands",
      "auth_accounts",
      "auth_sessions",
      "auth_events",
      "auth_login_limits",
      "stock_ledger",
      "employee_shifts",
      "shift_intervals",
      "work_events",
    ];
    const snapshots = new Map<string, unknown>();
    for (const table of names)
      snapshots.set(
        table,
        (await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows,
      );
    await db.close();
    w = new WarehouseService();
    assert.deepEqual(await w.snapshot(), before);
    assert.deepEqual(await w.updateWarehousePlan(command), cached);
    const versions = await w.authTransaction(async (tx) => {
      for (const table of names)
        assert.deepEqual(
          (await tx.query(`SELECT * FROM ${table} ORDER BY 1`)).rows,
          snapshots.get(table),
          table,
        );
      for (const table of [
        "stocktakes",
        "stocktake_rows",
        "stocktake_history",
        "stocktake_commands",
      ])
        assert.equal((await tx.query(`SELECT * FROM ${table}`)).rows.length, 0);
      assert.equal(
        (
          await tx.query<{ value: string }>(
            "SELECT value FROM metadata WHERE key='schema_version'",
          )
        ).rows[0].value,
        "11",
      );
      return (
        await tx.query(
          "SELECT * FROM stocktake_cell_versions ORDER BY location_id",
        )
      ).rows;
    });
    assert.equal(versions.length, before.locations.length);
    await w.onModuleDestroy();
    w = new WarehouseService();
    assert.deepEqual(await w.snapshot(), before);
    assert.deepEqual(
      await w.authTransaction(
        async (tx) =>
          (
            await tx.query(
              "SELECT * FROM stocktake_cell_versions ORDER BY location_id",
            )
          ).rows,
      ),
      versions,
    );
  } finally {
    await w?.onModuleDestroy();
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
