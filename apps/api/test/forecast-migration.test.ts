import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WarehouseService } from "../src/warehouse.service";
import { put, loadMarketplaces } from "../src/marketplaces/storage";

test("schema14 archive bootstrap preserves warehouse and credentials across restart and is idempotent", async () => {
  const previous = process.env.WMS_DATA_DIR;
  const dir = await mkdtemp(join(tmpdir(), "wms-forecast-migration-"));
  process.env.WMS_DATA_DIR = join(dir, "db");
  let warehouse = new WarehouseService();
  try {
    const baseline = await warehouse.snapshot();
    const snapshot = {
      provider: "ozon",
      asOf: "2026-10-25T12:00:00Z",
      from: "2026-10-01",
      to: "2026-10-24",
      products: [{ externalId: "one", name: "Товар", barcodes: [] }],
      stocks: [
        {
          externalId: "one",
          warehouseId: "fbo",
          warehouseName: "Склад",
          availableUnits: 3,
          reservedUnits: 0,
          inboundUnits: 0,
        },
      ],
      demand: [
        {
          externalId: "one",
          date: "2026-10-24",
          orderedUnits: 7,
          cancelledUnits: 1,
          soldUnits: null,
          returnedUnits: 0,
        },
      ],
      coverage: { catalog: true, stocks: true, demand: true, inbound: true },
      warnings: [],
    };
    await warehouse.authTransaction(async (tx) => {
      await put(tx, "marketplace_connections", "ozon", {
        provider: "ozon",
        encrypted: "preserved-ciphertext",
        clientId: "store-one",
        enabled: true,
        version: 2,
        lastSuccessVersion: 2,
        syncStatus: "success",
        lastAttemptAt: snapshot.asOf,
        lastSuccessAt: snapshot.asOf,
        message: null,
        warnings: [],
        runId: null,
      });
      await put(tx, "marketplace_snapshots", "ozon", snapshot);
      for (const table of [
        "forecast_history_facts",
        "forecast_history_coverage",
        "forecast_history_jobs",
        "forecast_history_pages",
        "forecast_stock_observations",
        "forecast_policies",
        "forecast_results",
      ])
        await tx.query(`DROP TABLE ${table}`);
      await tx.query(
        "UPDATE metadata SET value='14' WHERE key='schema_version'",
      );
    });
    await warehouse.onModuleDestroy();
    warehouse = new WarehouseService();
    assert.deepEqual(await warehouse.snapshot(), baseline);
    const first = await warehouse.authTransaction(async (tx) => {
      const m = await loadMarketplaces(tx);
      assert.equal(m.connections[0].encrypted, "preserved-ciphertext");
      assert.equal(m.connections[0].version, 2);
      assert.equal(m.connections[0].clientId, "store-one");
      assert.ok(m.connections[0].historyStoreId);
      const facts = (
        await tx.query(
          "SELECT id,payload FROM forecast_history_facts ORDER BY id",
        )
      ).rows;
      assert.ok(facts.length);
      assert.equal(
        (
          await tx.query<{ value: string }>(
            "SELECT value FROM metadata WHERE key='schema_version'",
          )
        ).rows[0].value,
        "16",
      );
      return {
        facts,
        revision: (
          await tx.query(
            "SELECT value FROM metadata WHERE key='forecast_history_revision'",
          )
        ).rows,
      };
    });
    await warehouse.onModuleDestroy();
    warehouse = new WarehouseService();
    await warehouse.authTransaction(async (tx) => {
      assert.deepEqual(
        (
          await tx.query(
            "SELECT id,payload FROM forecast_history_facts ORDER BY id",
          )
        ).rows,
        first.facts,
      );
      assert.deepEqual(
        (
          await tx.query(
            "SELECT value FROM metadata WHERE key='forecast_history_revision'",
          )
        ).rows,
        first.revision,
      );
    });
    assert.deepEqual(await warehouse.snapshot(), baseline);
  } finally {
    await warehouse.onModuleDestroy();
    await rm(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
  }
});
