import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BadRequestException } from "@nestjs/common";
import { WarehouseService } from "../src/warehouse.service";
import { readTaskHistory, withTaskHistory } from "../src/task-history";
import { requestAuth } from "../src/auth-context";

const request = () => ({ requestId: randomUUID() });

test("task scans are durable, rejected attempts do not mutate stock, and replays do not duplicate entries", async () => {
  const folder = await mkdtemp(join(tmpdir(), "wms-task-history-"));
  process.env.WMS_DATA_DIR = folder;
  let warehouse = new WarehouseService();
  try {
    const old = await warehouse.snapshot();
    const created = await warehouse.createTask({
      ...request(),
      skuId: "sku-space",
      boxesTarget: 1,
      employeeId: "employee-1",
    });
    const task = created.tasks.find(
      (item) => !old.tasks.some(({ id }) => id === item.id),
    )!;
    await warehouse.claimTask(task.id, {
      ...request(),
      employeeId: "employee-1",
    });
    const source = created.pallets.find(
      ({ id }) => id === task.reservations[0].palletId,
    )!;
    const sourceScan = {
      ...request(),
      employeeId: "employee-1",
      kind: "source" as const,
      value: source.code,
    };
    await warehouse.scanTask(task.id, sourceScan);
    await warehouse.scanTask(task.id, sourceScan);
    await warehouse.scanTask(task.id, {
      ...request(),
      employeeId: "employee-1",
      kind: "box",
      value: task.openBoxCode,
    });
    const before = await warehouse.snapshot();
    const badScan = {
      ...request(),
      employeeId: "employee-1",
      kind: "barcode" as const,
      value: "wrong-sku",
    };
    await assert.rejects(
      warehouse.scanTask(task.id, badScan),
      /Неверная тематика/,
    );
    await assert.rejects(
      warehouse.scanTask(task.id, badScan),
      /Неверная тематика/,
    );
    assert.deepEqual(await warehouse.snapshot(), before);

    // Identical product barcodes with different request IDs represent different physical units.
    for (let i = 0; i < 2; i++)
      await warehouse.scanTask(task.id, {
        ...request(),
        employeeId: "employee-1",
        kind: "barcode",
        value: "4601234000028",
      });
    const journal = await warehouse.authTransaction((tx) =>
      readTaskHistory(tx, { kind: "assembly", id: task.id }),
    );
    assert.equal(
      journal.items.filter((row) => row.action === "Скан паллеты").length,
      1,
    );
    assert.equal(
      journal.items.filter((row) => row.result === "rejected").length,
      1,
    );
    assert.equal(
      journal.items.filter((row) => row.scanValue === "4601234000028").length,
      2,
    );
    assert.equal(
      journal.items.find((row) => row.result === "rejected")!.scanValue,
      "wrong-sku",
    );
    assert(
      journal.items.every((row) => Number.isFinite(Date.parse(row.receivedAt))),
    );
    assert(journal.items.some((row) => row.action === "Задание создано"));
    const after = await warehouse.snapshot();
    assert.equal(after.tasks.find(({ id }) => id === task.id)!.scannedUnits, 2);
    await warehouse.onModuleDestroy();
    warehouse = new WarehouseService();
    const reopened = await warehouse.authTransaction((tx) =>
      readTaskHistory(tx, { kind: "assembly", id: task.id }),
    );
    assert.deepEqual(reopened, journal);
    await warehouse.scanTask(task.id, sourceScan);
    assert.deepEqual(
      await warehouse.authTransaction((tx) =>
        readTaskHistory(tx, { kind: "assembly", id: task.id }),
      ),
      journal,
    );
  } finally {
    await warehouse.onModuleDestroy();
    await rm(folder, { recursive: true, force: true });
  }
});

test("failure after a partial SQL write rolls back the write and persists only an audit rejection with authenticated identity", async () => {
  process.env.WMS_DATA_DIR = "memory://";
  const warehouse = new WarehouseService();
  try {
    const state = await warehouse.snapshot();
    const body = {
      ...request(),
      employeeId: "employee-2",
      kind: "barcode",
      value: "wrong",
    };
    const result = await requestAuth.run(
      {
        http: true,
        tokenHash: null,
        csrfToken: null,
        origin: null,
        employeeId: "employee-1",
        accountId: "account-1",
        role: "employee",
      },
      () =>
        warehouse.authTransaction((tx) =>
          withTaskHistory(
            tx,
            () => ({ kind: "assembly", id: "test-task" }),
            state,
            "scanTask/test-task",
            body,
            new Date().toISOString(),
            async () => {
              await tx.query(
                "INSERT INTO metadata(key,value) VALUES('partial-audit-test','value')",
              );
              throw new BadRequestException("Неверный код");
            },
          ),
        ),
    );
    assert("error" in result);
    const records = await warehouse.authTransaction(async (tx) => ({
      partial: (
        await tx.query(
          "SELECT value FROM metadata WHERE key='partial-audit-test'",
        )
      ).rows,
      audit: (
        await tx.query<{ employee_id: string; result: string }>(
          "SELECT employee_id,result FROM task_history WHERE task_id='test-task'",
        )
      ).rows,
    }));
    assert.equal(records.partial.length, 0);
    assert.deepEqual(records.audit, [
      { employee_id: "employee-1", result: "rejected" },
    ]);
  } finally {
    await warehouse.onModuleDestroy();
  }
});

test("HTTP audit is manager-only, observes only own task, requires CSRF, and never changes warehouse revision", async () => {
  process.env.WMS_DATA_DIR = "memory://";
  process.env.WEB_ORIGIN = "http://127.0.0.1:3080";
  const { createApp } = await import("../src/app");
  const app = await createApp();
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  type Session = { cookie: string; csrf: string };
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    session?: Session,
  ) => {
    const response = await fetch(`${base}/api/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: process.env.WEB_ORIGIN!,
        "X-WMS-Request": "1",
        ...(session
          ? { Cookie: session.cookie, "X-WMS-CSRF": session.csrf }
          : {}),
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  };
  const session = (r: Awaited<ReturnType<typeof call>>) => ({
    cookie: r.cookie,
    csrf: r.body.csrfToken,
  });
  try {
    const w = app.get(WarehouseService);
    const created = await w.createTask({
      ...request(),
      skuId: "sku-space",
      boxesTarget: 1,
      employeeId: "employee-1",
    });
    const task = created.tasks.find(
      (t) => t.skuId === "sku-space" && t.employeeId === "employee-1",
    )!;
    await w.claimTask(task.id, { ...request(), employeeId: "employee-1" });
    const audit = {
      ...request(),
      kind: "assembly",
      id: task.id,
      value: "wrong-local-code",
      step: "Сканируйте паллету",
    };
    assert.equal((await call("POST", "task-scans", audit)).status, 401);
    const setup = await call("POST", "auth/setup", {
      name: "Руководитель",
      login: "manager",
      password: "Manager-password-123",
    });
    assert.equal(setup.status, 200);
    const manager = session(setup);
    assert.equal(
      (
        await call(
          "POST",
          "auth/accounts",
          {
            employeeId: "employee-1",
            login: "scanner",
            role: "employee",
            password: "Temporary-password-123",
          },
          manager,
        )
      ).status,
      200,
    );
    const login = session(
      await call("POST", "auth/login", {
        login: "scanner",
        password: "Temporary-password-123",
      }),
    );
    const worker = session(
      await call(
        "POST",
        "auth/change-password",
        {
          currentPassword: "Temporary-password-123",
          newPassword: "Worker-password-456",
        },
        login,
      ),
    );
    const before = await w.snapshot();
    assert.equal(
      (await call("POST", "task-scans", audit, { ...worker, csrf: "wrong" }))
        .status,
      403,
    );
    assert.equal(
      (
        await call(
          "POST",
          "task-scans",
          { ...audit, id: "another-task" },
          worker,
        )
      ).status,
      403,
    );
    assert.equal(
      (await call("POST", "task-scans", { ...audit, kind: "unknown" }, worker))
        .status,
      400,
    );
    assert.equal((await call("POST", "task-scans", audit, worker)).status, 200);
    assert.equal((await call("POST", "task-scans", audit, worker)).status, 200);
    assert.equal(
      (await call("POST", "task-scans", { ...audit, value: "changed" }, worker))
        .status,
      409,
    );
    assert.equal(
      (
        await call(
          "GET",
          `task-history?kind=assembly&id=${task.id}`,
          undefined,
          worker,
        )
      ).status,
      403,
    );
    const journal = await call(
      "GET",
      `task-history?kind=assembly&id=${task.id}`,
      undefined,
      manager,
    );
    assert.equal(journal.status, 200);
    assert.equal(
      journal.body.items.filter(
        (r: { result: string }) => r.result === "observed",
      ).length,
      1,
    );
    assert.equal(
      journal.body.items.find(
        (r: { result: string }) => r.result === "observed",
      ).employeeName,
      before.employees.find((e) => e.id === "employee-1")!.name,
    );
    assert.deepEqual(await w.snapshot(), before);
  } finally {
    await app.close();
  }
});
