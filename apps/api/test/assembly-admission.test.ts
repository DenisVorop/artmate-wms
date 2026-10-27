import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { WarehouseService } from "../src/warehouse.service";
import { assemblyPressure } from "../src/work-automation/assembly-pressure";

const req = () => ({ requestId: randomUUID() });

test("concurrent box admission reserves one physical slot, final scan survives full auto-next, and real putaway releases that slot", async () => {
  process.env.WMS_DATA_DIR = "memory://";
  const warehouse = new WarehouseService();
  try {
    let state = await warehouse.snapshot();
    const location = state.locations.find(
      (item) => item.id === "loc-assembly",
    )!;
    await warehouse.updateLocation(location.id, { ...req(), maxBoxes: 1 });
    const createTask = async (employeeId: string) => {
      const before = await warehouse.snapshot();
      const next = await warehouse.createTask({
        ...req(),
        skuId: "sku-space",
        boxesTarget: 1,
        employeeId,
      });
      return next.tasks.find(
        (item) => !before.tasks.some((old) => old.id === item.id),
      )!;
    };
    const tasks = [
      await createTask("employee-1"),
      await createTask("employee-2"),
    ];
    assert.notEqual(tasks[0].id, tasks[1].id);
    await Promise.all(
      tasks.map((task) =>
        warehouse.claimTask(task.id, {
          ...req(),
          employeeId: task.employeeId!,
        }),
      ),
    );
    const source = (await warehouse.snapshot()).pallets.find(
      (pallet) => pallet.id === tasks[0].reservations[0].palletId,
    )!;
    await Promise.all(
      tasks.map((task) =>
        warehouse.scanTask(task.id, {
          ...req(),
          employeeId: task.employeeId!,
          kind: "source",
          value: source.code,
        }),
      ),
    );
    const admissions = tasks.map((task) => ({
      ...req(),
      employeeId: task.employeeId!,
      kind: "box" as const,
      value: task.openBoxCode,
    }));
    const results = await Promise.allSettled(
      tasks.map((task, index) =>
        warehouse.scanTask(task.id, admissions[index]),
      ),
    );
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const winnerIndex = results.findIndex(
      (result) => result.status === "fulfilled",
    );
    const loserIndex = 1 - winnerIndex;
    const winner = tasks[winnerIndex],
      loser = tasks[loserIndex];
    state = await warehouse.snapshot();
    const totalBeforePacking = state.balance.totalUnits;
    const boxesBeforePacking = state.boxes.length;
    assert.equal(state.tasks.filter((task) => task.boxCodeConfirmed).length, 1);
    assert.equal(assemblyPressure(state).committedBoxes, 1);
    assert.equal(assemblyPressure(state).boxes, 0);
    assert.equal(assemblyPressure(state).level, "full");
    assert.match(assemblyPressure(state).message, /Дождитесь/);
    const next = await createTask(winner.employeeId!);
    for (let index = 0; index < winner.unitsPerBox - 1; index++)
      await warehouse.scanTask(winner.id, {
        ...req(),
        employeeId: winner.employeeId!,
        kind: "barcode",
        value: "4601234000028",
      });
    const final = {
      ...req(),
      employeeId: winner.employeeId!,
      kind: "barcode" as const,
      value: "4601234000028",
    };
    state = await warehouse.scanTask(winner.id, final);
    assert.equal(
      state.tasks.find((task) => task.id === winner.id)!.status,
      "completed",
    );
    assert.equal(
      state.tasks.find((task) => task.id === next.id)!.status,
      "queued",
    );
    assert.equal(
      state.tasks.some(
        (task) =>
          task.employeeId === winner.employeeId && task.status === "active",
      ),
      false,
    );
    assert.equal(state.balance.totalUnits, totalBeforePacking);
    assert.equal(state.boxes.length, boxesBeforePacking + 1);
    assert.equal(assemblyPressure(state).level, "full");
    const persisted = await warehouse.snapshot();
    assert.deepEqual(await warehouse.scanTask(winner.id, final), state);
    assert.deepEqual(await warehouse.snapshot(), persisted);
    const beforeRejectedRetry = await warehouse.snapshot();
    await assert.rejects(
      warehouse.scanTask(loser.id, admissions[loserIndex]),
      /вместимость|заполнена/,
    );
    assert.deepEqual(await warehouse.snapshot(), beforeRejectedRetry);
    const packed = state.boxes.find((box) => box.code === winner.openBoxCode)!;
    const putaway = state.putawayTasks.find(
      (task) => task.boxId === packed.id,
    )!;
    await warehouse.claimPutawayTask(putaway.id, {
      ...req(),
      employeeId: "employee-3",
    });
    state = await warehouse.takePutawayBox(putaway.id, {
      ...req(),
      employeeId: "employee-3",
      boxCode: packed.code,
    });
    assert.equal(
      state.boxes.find((box) => box.id === packed.id)!.status,
      "in_transit",
    );
    assert.equal(state.balance.totalUnits, totalBeforePacking);
    assert.equal(assemblyPressure(state).boxes, 0);
    assert.equal(assemblyPressure(state).level, "normal");
    // A rejected request is not cached as a success and can retry after a real release.
    state = await warehouse.scanTask(loser.id, admissions[loserIndex]);
    assert.equal(
      state.tasks.find((task) => task.id === loser.id)!.boxCodeConfirmed,
      true,
    );
    assert.equal(assemblyPressure(state).committedBoxes, 1);
    assert.equal(assemblyPressure(state).level, "full");
    assert.equal(
      state.pallets.filter(
        (pallet) => pallet.kind === "assembly" && pallet.status === "stored",
      ).length,
      1,
    );
  } finally {
    await warehouse.onModuleDestroy();
  }
});
