import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { WarehouseService } from "../src/warehouse.service";
import { WorkAutomationService } from "../src/work-automation/service";

test("automatic assembly waits for an active opening count and resumes checking after it is approved", async () => {
  const old = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  const warehouse = new WarehouseService();
  try {
    const initial = await warehouse.snapshot();
    await warehouse.authTransaction((tx) =>
      tx.query("INSERT INTO stocktakes(id,payload) VALUES($1,$2)", [
        "opening",
        JSON.stringify({ id: "opening", mode: "opening", status: "counting" }),
      ]),
    );
    let forecasts = 0;
    const service = WorkAutomationService.forTesting(warehouse, {
      forecast: async () => {
        forecasts++;
        return {
          key: "pending",
          cacheCurrent: false,
          goals: {},
          minimumBoxes: {},
        };
      },
    });
    assert.equal(await service.runWorkAutomation(), "skipped");
    assert.equal(forecasts, 0);
    assert.deepEqual(await warehouse.snapshot(), initial);
    const runtime = await warehouse.authTransaction((tx) =>
      tx.query<{ payload: { message: string } }>(
        "SELECT payload FROM automation_settings WHERE id='runtime'",
      ),
    );
    assert.match(runtime.rows[0].payload.message, /первичная/);
    await warehouse.authTransaction((tx) =>
      tx.query("UPDATE stocktakes SET payload=$2 WHERE id=$1", [
        "opening",
        JSON.stringify({ id: "opening", mode: "opening", status: "approved" }),
      ]),
    );
    assert.equal(await service.runWorkAutomation(), "skipped");
    assert.equal(forecasts, 1);
    assert.deepEqual(await warehouse.snapshot(), initial);
  } finally {
    await warehouse.onModuleDestroy();
    if (old === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = old;
  }
});
