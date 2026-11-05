import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { WarehouseService } from "../src/warehouse.service";
test("schema9 adds empty auth storage while preserving all warehouse entities revision immutable ledger and legacy cached responses across repeated restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-auth-migration-")),
    path = join(dir, "db"),
    previous = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = path;
  let w: WarehouseService | undefined;
  try {
    w = new WarehouseService();
    const command = {
      requestId: randomUUID(),
      name: "Склад до подключения входа",
    };
    const original = await w.updateWarehousePlan(command),
      ledger = await w.getStockLedger({});
    await w.onModuleDestroy();
    w = undefined;
    const db = new PGlite(path);
    await db.waitReady;
    // Reconstruct schema8 only inside this brand-new isolated fixture.
    await db.exec(
      "DROP TABLE auth_sessions;DROP TABLE auth_accounts;DROP TABLE auth_login_limits;DROP TABLE auth_events;UPDATE metadata SET value='8' WHERE key='schema_version'",
    );
    const savedCommands = (
      await db.query(
        "SELECT request_id,fingerprint,response,created_at FROM commands ORDER BY request_id",
      )
    ).rows;
    const savedLedger = (
      await db.query("SELECT * FROM stock_ledger ORDER BY id")
    ).rows;
    await db.close();
    w = new WarehouseService();
    assert.deepEqual(await w.snapshot(), original);
    assert.deepEqual(await w.getStockLedger({}), ledger);
    assert.deepEqual(await w.updateWarehousePlan(command), original);
    await w.onModuleDestroy();
    w = undefined;
    const inspect = new PGlite(path);
    await inspect.waitReady;
    assert.deepEqual(
      (
        await inspect.query(
          "SELECT request_id,fingerprint,response,created_at FROM commands ORDER BY request_id",
        )
      ).rows,
      savedCommands,
    );
    assert.deepEqual(
      (await inspect.query("SELECT * FROM stock_ledger ORDER BY id")).rows,
      savedLedger,
    );
    assert.equal(
      (
        await inspect.query<{ value: string }>(
          "SELECT value FROM metadata WHERE key='schema_version'",
        )
      ).rows[0].value,
      "19",
    );
    for (const table of [
      "auth_accounts",
      "auth_sessions",
      "auth_login_limits",
      "auth_events",
    ])
      assert.equal(
        (
          await inspect.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM ${table}`,
          )
        ).rows[0].count,
        0,
      );
    await inspect.close();
    w = new WarehouseService();
    assert.deepEqual(await w.snapshot(), original);
    assert.deepEqual(await w.getStockLedger({}), ledger);
  } finally {
    await w?.onModuleDestroy();
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
