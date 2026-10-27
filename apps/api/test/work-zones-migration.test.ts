import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { WarehouseService } from "../src/warehouse.service";
test("schema12 derives empty zones without rewriting old warehouse metadata entities revision commands or histories; restart and old replay remain intact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-zone-migration-")),
    path = join(dir, "db"),
    old = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = path;
  let w: WarehouseService | undefined;
  try {
    w = new WarehouseService();
    const command = { requestId: randomUUID(), name: "Исторический склад" },
      cached = await w.updateWarehousePlan(command),
      revision = cached.revision;
    await w.onModuleDestroy();
    w = undefined;
    const db = new PGlite(path);
    await db.waitReady;
    const plan = (
        await db.query<{ value: string }>(
          "SELECT value FROM metadata WHERE key='warehouse'",
        )
      ).rows[0].value,
      legacy = JSON.parse(plan);
    delete legacy.workZones;
    delete legacy.zoneWork;
    await db.query("UPDATE metadata SET value=$1 WHERE key='warehouse'", [
      JSON.stringify(legacy),
    ]);
    const legacyCached = structuredClone(cached);
    delete (legacyCached.warehouse as any).workZones;
    delete (legacyCached.warehouse as any).zoneWork;
    await db.query("UPDATE commands SET response=$2 WHERE request_id=$1", [
      command.requestId,
      JSON.stringify(legacyCached),
    ]);
    await db.query("UPDATE metadata SET value='11' WHERE key='schema_version'");
    const tables = (
        await db.query<{ tablename: string }>(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'metadata' ORDER BY tablename",
        )
      ).rows.map((r) => r.tablename),
      snapshot = new Map<string, unknown>();
    for (const t of tables)
      snapshot.set(t, (await db.query(`SELECT * FROM ${t} ORDER BY 1`)).rows);
    const metadata = (
      await db.query(
        "SELECT * FROM metadata WHERE key<>'schema_version' ORDER BY key",
      )
    ).rows;
    await db.close();
    w = new WarehouseService();
    const next = await w.snapshot();
    assert.deepEqual(next.warehouse.workZones, []);
    assert.deepEqual(next.warehouse.zoneWork, []);
    assert.equal(next.revision, revision);
    assert.deepEqual(await w.updateWarehousePlan(command), cached);
    await w.authTransaction(async (tx) => {
      for (const t of tables)
        assert.deepEqual(
          (await tx.query(`SELECT * FROM ${t} ORDER BY 1`)).rows,
          snapshot.get(t),
          t,
        );
      assert.deepEqual(
        (
          await tx.query(
            "SELECT * FROM metadata WHERE key<>'schema_version' ORDER BY key",
          )
        ).rows,
        metadata,
      );
      assert.equal(
        (
          await tx.query<{ value: string }>(
            "SELECT value FROM metadata WHERE key='schema_version'",
          )
        ).rows[0].value,
        "17",
      );
    });
    await w.onModuleDestroy();
    w = new WarehouseService();
    assert.deepEqual(await w.snapshot(), next);
  } finally {
    await w?.onModuleDestroy();
    if (old === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = old;
    await rm(dir, { recursive: true, force: true });
  }
});
