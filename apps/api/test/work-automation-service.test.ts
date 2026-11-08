import { assemblyQueueOrder } from "../src/assembly-queue";
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WarehouseService } from "../src/warehouse.service";
import { requestAuth } from "../src/auth-context";
import { WorkAutomationService } from "../src/work-automation/service";
import {
  initializeWorkAutomationStorage,
  automationOrigins,
  automationSettings,
  saveAutomationOrigin,
} from "../src/work-automation/storage";
import type {
  MarketplacePlanDto,
  MarketplacePlanRowDto,
} from "../src/marketplaces/dto";
const manager = <T>(fn: () => T) =>
  requestAuth.run(
    {
      http: true,
      tokenHash: "automation-manager",
      csrfToken: "csrf-manager",
      origin: "http://127.0.0.1:3080",
    },
    fn,
  );
test("automatic work persists FIFO tasks and reconciles only untouched origins with atomic pause/auth/replay", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "wms-work-automation-"));
  const previousDir = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = join(dir, "db");
  let warehouse: WarehouseService | undefined;
  try {
    warehouse = new WarehouseService();
    const w = warehouse;
    await w.snapshot();
    await w.authTransaction(async (tx) => {
      await initializeWorkAutomationStorage(tx);
      for (const role of ["manager", "employee"]) {
        await tx.query(
          "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES($1,$2,$1,'test-only',$3,FALSE)",
          [
            `automation-${role}`,
            role === "manager" ? "employee-3" : "employee-1",
            role,
          ],
        );
        await tx.query(
          "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES($1,$1,$1,$2,NOW()+INTERVAL '1 hour')",
          [`automation-${role}`, `csrf-${role}`],
        );
      }
    });
    let boxes = 3,
      cacheCurrent = true,
      planCalls = 0,
      raw = 1000;
    const makeService = () =>
      WorkAutomationService.forTesting(w, {
        forecast: async () => ({
          key: "published",
          cacheCurrent,
          goals: {},
          minimumBoxes: {},
        }),
        plan: () => {
          planCalls++;
          return {
            rows: [
              {
                skuId: "sku-cats",
                skuName: "Котики-2",
                unitsPerBox: 20,
                averageDailyUnits: 10,
                localAfterAssemblyUnits: 0,
                recommendedBoxes: boxes,
                recommendedUnits: boxes * 20,
                rawAvailableUnits: raw,
                canCreate: boxes > 0,
                dataComplete: true,
                backlogCapacityKnown: true,
                backlogCanCreate: false,
                backlogRank: 1,
                unregisteredUnits: 0,
                stockEstimated: false,
                proposalHash: `published-${boxes}`,
                providers: [],
                blockers: [],
              } as unknown as MarketplacePlanRowDto,
            ],
          } as MarketplacePlanDto;
        },
      });
    const service = makeService();
    const origins = () => w.authTransaction((tx) => automationOrigins(tx));
    await t.test(
      "manager reads are pure; employees and system cannot access settings",
      async () => {
        const before = await w.snapshot();
        await assert.rejects(service.getWorkAutomation(), /Войдите/);
        await assert.rejects(
          requestAuth.run(
            {
              http: true,
              tokenHash: "automation-employee",
              csrfToken: "csrf-employee",
              origin: "http://127.0.0.1:3080",
            },
            () => service.getWorkAutomation(),
          ),
          /руководителя/,
        );
        assert.equal(
          (await manager(() => service.getWorkAutomation())).enabled,
          true,
        );
        assert.deepEqual(await w.snapshot(), before);
        assert.equal(planCalls, 0);
      },
    );
    await t.test(
      "current published plan creates one task per box with FIFO and durable provenance; concurrent runs deduplicate",
      async () => {
        const before = await w.snapshot();
        const outcomes = await Promise.all([
          service.runWorkAutomation(),
          makeService().runWorkAutomation(),
        ]);
        assert.equal(outcomes.filter((value) => value === "updated").length, 1);
        const after = await w.snapshot();
        const tasks = after.tasks.filter(
          (item) => !before.tasks.some((old) => old.id === item.id),
        );
        assert.equal(tasks.length, 3);
        assert.ok(
          tasks.every(
            (task) =>
              task.boxesTarget === 1 &&
              task.employeeId === null &&
              task.status === "queued",
          ),
        );
        assert.deepEqual(
          tasks
            .sort(assemblyQueueOrder(tasks, "employee"))
            .map((task) =>
              task.reservations.map((r) => [r.palletId, r.quantity]),
            ),
          [
            [["pallet-raw-0", 20]],
            [
              ["pallet-raw-0", 10],
              ["pallet-cats-new", 10],
            ],
            [["pallet-cats-new", 20]],
          ],
        );
        const recorded = await origins();
        assert.equal(recorded.length, 3);
        assert.deepEqual(
          new Set(recorded.map((origin) => origin.taskId)),
          new Set(tasks.map((task) => task.id)),
        );
        assert.ok(
          recorded.every(
            (origin) =>
              origin.proposalHash === "published-3" &&
              origin.purpose === "urgent",
          ),
        );
        assert.deepEqual(after.boxes, before.boxes);
        assert.deepEqual(after.pallets, before.pallets);
        assert.deepEqual(after.shipments, before.shipments);
        assert.deepEqual(after.receipts, before.receipts);
        assert.equal(await makeService().runWorkAutomation(), "skipped");
      },
    );
    await t.test(
      "a changed plan retains two single tasks and withdraws obsolete work with snapshot",
      async () => {
        const original = (await w.snapshot()).tasks.find(
          (task) => task.skuId === "sku-cats" && task.employeeId === null,
        )!;
        boxes = 2;
        assert.equal(await service.runWorkAutomation(), "updated");
        const reduced = (await w.snapshot()).tasks.find(
          (task) => task.id === original.id,
        )!;
        assert.equal(reduced.code, original.code);
        assert.equal(reduced.boxesTarget, 1);
        assert.equal(
          reduced.reservations.reduce((n, r) => n + r.quantity, 0),
          20,
        );
        boxes = 0;
        assert.equal(await service.runWorkAutomation(), "updated");
        assert.equal(
          (await w.snapshot()).tasks.some((task) => task.id === original.id),
          false,
        );
        const origin = (await origins()).find(
          (item) => item.taskId === original.id,
        )!;
        assert.equal(origin.status, "withdrawn");
        assert.equal(origin.withdrawnTask?.boxesTarget, 1);
        assert.equal(origin.withdrawnTask?.boxesCompleted, 0);
        assert.ok(origin.withdrawnReason);
      },
    );
    await t.test(
      "stale forecast does not compute a fallback plan and raw shortage does not fabricate tasks",
      async () => {
        const before = await w.snapshot();
        const calls = planCalls;
        cacheCurrent = false;
        boxes = 3;
        assert.equal(await service.runWorkAutomation(), "skipped");
        assert.equal(planCalls, calls);
        assert.deepEqual(await w.snapshot(), before);
        cacheCurrent = true;
        raw = 0;
        assert.equal(await service.runWorkAutomation(), "skipped");
        assert.deepEqual(await w.snapshot(), before);
        raw = 1000;
      },
    );
    await t.test(
      "pause requires fresh CSRF authority and strict body; replay is namespaced and no work runs while paused",
      async () => {
        const command = { requestId: randomUUID(), enabled: false };
        await assert.rejects(
          service.updateWorkAutomationSettings(command),
          /Войдите/,
        );
        await assert.rejects(
          requestAuth.run(
            {
              http: true,
              tokenHash: "automation-manager",
              csrfToken: "wrong",
              origin: "http://127.0.0.1:3080",
            },
            () => service.updateWorkAutomationSettings(command),
          ),
          /Проверка/,
        );
        await assert.rejects(
          manager(() =>
            service.updateWorkAutomationSettings({
              ...command,
              injected: true,
            } as never),
          ),
          /Проверьте/,
        );
        const paused = await manager(() =>
          service.updateWorkAutomationSettings(command),
        );
        assert.equal(paused.enabled, false);
        assert.deepEqual(
          await manager(() => service.updateWorkAutomationSettings(command)),
          paused,
        );
        await assert.rejects(
          manager(() =>
            service.updateWorkAutomationSettings({ ...command, enabled: true }),
          ),
          /requestId/,
        );
        const before = await w.snapshot(),
          calls = planCalls;
        assert.equal(await service.runWorkAutomation(), "skipped");
        assert.equal(planCalls, calls);
        assert.deepEqual(await w.snapshot(), before);
        const other = randomUUID();
        await w.authTransaction((tx) =>
          tx.query(
            "INSERT INTO commands(request_id,fingerprint,response) VALUES($1,'other','{}')",
            [other],
          ),
        );
        await assert.rejects(
          manager(() =>
            service.updateWorkAutomationSettings({
              requestId: other,
              enabled: true,
            }),
          ),
          /requestId/,
        );
        await manager(() =>
          service.updateWorkAutomationSettings({
            requestId: randomUUID(),
            enabled: true,
          }),
        );
      },
    );
    await t.test(
      "abort under the SQL lock rolls back new work and provenance together",
      async () => {
        const before = await w.snapshot(),
          priorOrigins = await origins();
        const controller = new AbortController();
        const apply = w.applyAutomaticTasks.bind(w);
        w.applyAutomaticTasks = async (...args) => {
          await apply(...args);
          if (args[2].length) controller.abort();
        };
        try {
          await assert.rejects(service.runWorkAutomation(controller.signal));
        } finally {
          w.applyAutomaticTasks = apply;
        }
        assert.deepEqual(await w.snapshot(), before);
        assert.deepEqual(await origins(), priorOrigins);
      },
    );
    await t.test(
      "the system entry rejects HTTP context and disabled settings persist on restart",
      async () => {
        await assert.rejects(
          manager(() => service.runWorkAutomation()),
          /HTTP/,
        );
        await manager(() =>
          service.updateWorkAutomationSettings({
            requestId: randomUUID(),
            enabled: false,
          }),
        );
        assert.equal(await makeService().runWorkAutomation(), "skipped");
        assert.equal(
          (await w.authTransaction((tx) => automationSettings(tx))).enabled,
          false,
        );
        await w.authTransaction((tx) =>
          tx.query(
            "DELETE FROM auth_sessions WHERE account_id='automation-manager'",
          ),
        );
        await assert.rejects(
          manager(() =>
            service.updateWorkAutomationSettings({
              requestId: randomUUID(),
              enabled: true,
            }),
          ),
          /Сессия/,
        );
      },
    );
  } finally {
    await warehouse?.onModuleDestroy();
    if (previousDir === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrent runs reconcile only planned work through withdrawal, claim and completion", async () => {
  const previousDir = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  let warehouse: WarehouseService | undefined;
  try {
    warehouse = new WarehouseService();
    const w = warehouse;
    await w.snapshot();
    for (let index = 0; index < 4; index++)
      await w.createTask({
        requestId: randomUUID(),
        skuId: "sku-flowers",
        boxesTarget: 1,
      });
    const manual = structuredClone((await w.snapshot()).tasks);
    const legacyIds: string[] = [];
    await w.authTransaction(async (tx) => {
      const state = await w.stocktakeState(tx);
      const previousIds = new Set(state.tasks.map((task) => task.id));
      // Legacy queue, using the normal atomic FIFO reservation path.
      await w.applyAutomaticTasks(
        tx,
        state,
        Array.from({ length: 6 }, () => ({
          kind: "create" as const,
          skuId: "sku-cats",
          boxesTarget: 1,
          purpose: "urgent" as const,
          proposalHash: "legacy",
        })),
      );
      for (const task of state.tasks.filter(
        (task) => !previousIds.has(task.id),
      )) {
        legacyIds.push(task.id);
        await saveAutomationOrigin(tx, {
          taskId: task.id,
          skuId: task.skuId,
          purpose: "urgent",
          proposalHash: "legacy",
          createdAt: "2026-10-27T10:00:00Z",
          updatedAt: "2026-10-27T10:00:00Z",
          boxesTarget: 1,
          status: "queued",
          withdrawnAt: null,
          withdrawnReason: null,
          withdrawnTask: null,
        });
      }
    });
    let completedSpace = false;
    const row = (skuId: string, rank: number, boxes = 1) =>
      ({
        skuId,
        skuName: skuId,
        unitsPerBox: 20,
        averageDailyUnits: 10,
        localAfterAssemblyUnits: 0,
        recommendedBoxes: boxes,
        recommendedUnits: boxes * 20,
        rawAvailableUnits: 1000,
        canCreate: boxes > 0,
        dataComplete: true,
        backlogCapacityKnown: true,
        backlogCanCreate: false,
        backlogRank: rank,
        unregisteredUnits: 0,
        stockEstimated: false,
        proposalHash: `current-${skuId}`,
        providers: [],
        blockers: [],
      }) as unknown as MarketplacePlanRowDto;
    const makeService = () =>
      WorkAutomationService.forTesting(w, {
        forecast: async () => ({
          key: "published",
          cacheCurrent: true,
          goals: {},
          minimumBoxes: {},
        }),
        plan: (effective) =>
          ({
            rows: [
              row(
                "sku-space",
                1,
                completedSpace ||
                  effective.tasks.some(
                    (task) =>
                      task.skuId === "sku-space" && task.status === "active",
                  )
                  ? 0
                  : 1,
              ),
              row("sku-dinos", 2, completedSpace ? 1 : 0),
              row("sku-flowers", 3, 0),
            ],
          }) as MarketplacePlanDto,
      });
    const run = () =>
      Promise.all([
        makeService().runWorkAutomation(),
        makeService().runWorkAutomation(),
      ]);
    const before = await w.snapshot();
    assert.equal(before.tasks.length, 10);
    assert.equal(
      (await run()).filter((result) => result === "updated").length,
      1,
    );
    const after = await w.snapshot();
    assert.equal(
      after.tasks.filter((task) => task.status !== "completed").length,
      5,
    );
    assert.deepEqual(
      after.tasks.filter((task) => manual.some((old) => old.id === task.id)),
      manual,
    );
    const automatic = after.tasks.find((task) => task.autoPurpose)!;
    assert.equal(automatic.skuId, "sku-space");
    assert.deepEqual(
      automatic.reservations.map((r) => [r.palletId, r.quantity]),
      [["pallet-raw-1", 20]],
    );
    assert.deepEqual(after.pallets, before.pallets);
    const origins = await w.authTransaction((tx) => automationOrigins(tx));
    const withdrawn = origins.filter((origin) =>
      legacyIds.includes(origin.taskId),
    );
    assert.equal(withdrawn.length, 6);
    assert.ok(
      withdrawn.every(
        (origin) =>
          origin.status === "withdrawn" &&
          origin.withdrawnAt &&
          origin.withdrawnReason,
      ),
    );
    assert.equal(
      withdrawn
        .flatMap((origin) => origin.withdrawnTask!.reservations)
        .reduce((sum, r) => sum + r.quantity, 0),
      120,
    );
    assert.ok(
      after.tasks.every((task) =>
        task.reservations.every(
          (r) => !["pallet-raw-0", "pallet-cats-new"].includes(r.palletId),
        ),
      ),
    );
    await w.claimTask(automatic.id, {
      requestId: randomUUID(),
      employeeId: "employee-1",
    });
    const claimed = await w.snapshot();
    assert.deepEqual(await run(), ["skipped", "skipped"]);
    assert.deepEqual((await w.snapshot()).tasks, claimed.tasks);
    const source = claimed.pallets.find(
      (p) => p.id === automatic.reservations[0].palletId,
    )!;
    const scan = (kind: "source" | "box" | "barcode", value: string) =>
      w.scanTask(automatic.id, {
        requestId: randomUUID(),
        employeeId: "employee-1",
        kind,
        value,
      });
    await scan("source", source.code);
    await scan("box", automatic.openBoxCode);
    const sku = claimed.skus.find((sku) => sku.id === automatic.skuId)!;
    for (let index = 0; index < sku.unitsPerBox; index++)
      await scan("barcode", sku.barcode);
    const finished = await w.snapshot();
    assert.equal(
      finished.tasks.find((task) => task.id === automatic.id)!.status,
      "completed",
    );
    assert.equal(
      finished.tasks.filter((task) => task.status !== "completed").length,
      4,
    );
    completedSpace = true;
    assert.equal(
      (await run()).filter((result) => result === "updated").length,
      1,
    );
    const replenished = await w.snapshot();
    assert.equal(
      replenished.tasks.filter((task) => task.status !== "completed").length,
      5,
    );
    const added = replenished.tasks.filter(
      (task) => !finished.tasks.some((old) => old.id === task.id),
    );
    assert.equal(added.length, 1);
    assert.equal(added[0].skuId, "sku-dinos");
    assert.equal(added[0].status, "queued");
    assert.equal(added[0].employeeId, null);
  } finally {
    await warehouse?.onModuleDestroy();
    if (previousDir === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previousDir;
  }
});
