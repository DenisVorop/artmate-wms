import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app";
import { WarehouseService } from "../src/warehouse.service";
test("public probes read readiness only and cannot bypass warehouse authentication", async () => {
  const oldData = process.env.WMS_DATA_DIR,
    oldEnv = process.env.NODE_ENV;
  process.env.WMS_DATA_DIR = "memory://";
  process.env.NODE_ENV = "test";
  const app = await createApp();
  try {
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl(),
      warehouse = app.get(WarehouseService);
    const before = await warehouse.snapshot();
    const get = (path: string, method = "GET") =>
      fetch(base + path, { method });
    for (const path of ["/health/live", "/health/ready"]) {
      const response = await get(path);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "ok" });
      assert.equal((await get(path, "HEAD")).status, 200);
      assert.equal((await get(path, "POST")).status, 404);
    }
    assert.deepEqual(await warehouse.snapshot(), before);
    assert.equal((await get("/api/workspace")).status, 401);
    assert.equal((await get("/api/stocktakes")).status, 401);
    assert.equal((await get("/health/workspace")).status, 404);
    const check = warehouse.checkReady.bind(warehouse);
    warehouse.checkReady = async () => {
      throw new Error("sensitive-internal-error");
    };
    const failed = await get("/health/ready");
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { status: "unavailable" });
    assert.equal((await get("/health/live")).status, 200);
    warehouse.checkReady = check;
    assert.equal((await get("/health/ready")).status, 200);
  } finally {
    await app.close();
    if (oldData === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = oldData;
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  }
});
