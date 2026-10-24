import assert from "node:assert/strict";
import { test } from "node:test";
import type { EmployeeDto, TaskDto } from "@/shared/api/generated/model";
import {
  assemblyTaskVisible,
  assemblyStep,
  assignmentBlocked,
  claimBlocked,
  compareQueue,
  nextSource,
  preparationHint,
  queueTasks,
  taskTab,
} from "./assembly-queue";
const actor: EmployeeDto = {
  id: "actor",
  name: "Анна",
  initials: "А",
  role: "Сборщик",
  status: "working",
  boxesToday: 0,
  unitsToday: 0,
};
const task = (patch: Partial<TaskDto> = {}): TaskDto => ({
  id: "task",
  code: "JOB-001",
  skuId: "sku",
  employeeId: null,
  status: "queued",
  createdAt: "2024-01-01T12:00:00Z",
  boxesTarget: 2,
  boxesCompleted: 0,
  unitsPerBox: 20,
  scannedUnits: 0,
  sourcePalletId: null,
  boxCodeConfirmed: false,
  openBoxCode: "BOX-001",
  openBoxContents: [],
  reservations: [{ lotId: "lot", palletId: "raw-1", quantity: 40 }],
  ...patch,
});
test("Свободные, назначенные/пауза, активные и завершённые не смешиваются", () => {
  assert.equal(taskTab(task()), "free");
  assert.equal(taskTab(task({ employeeId: "actor" })), "assigned");
  assert.equal(taskTab(task({ status: "paused" })), "assigned");
  assert.equal(
    taskTab(task({ status: "active", employeeId: "actor" })),
    "active",
  );
  assert.equal(taskTab(task({ status: "completed" })), "completed");
});
test("Сортировка повторяет стабильную очередь сервера, legacy null не становится выдуманной датой", () => {
  const tasks = [
    task({ id: "b", createdAt: null }),
    task({ id: "new", createdAt: "2025-01-01" }),
    task({ id: "a", createdAt: null }),
    task({ id: "old", createdAt: "2024-01-01" }),
  ];
  assert.deepEqual(
    [...tasks].sort(compareQueue).map((row) => row.id),
    ["a", "b", "old", "new"],
  );
  assert.equal(tasks[0].createdAt, null);
});
test("Поиск читает название и исполнителя, не меняя исходный массив", () => {
  const tasks = [
    task({ id: "later", createdAt: "2025-01-01" }),
    task({ id: "first" }),
    task({ id: "assigned", employeeId: "actor" }),
  ];
  const data = {
    tasks,
    skus: [{ id: "sku", name: "Котики-2" }],
    employees: [actor],
  };
  assert.deepEqual(
    queueTasks(data, "free", "КОТИКИ").map((row) => row.id),
    ["first", "later"],
  );
  assert.deepEqual(
    queueTasks(data, "assigned", "анна").map((row) => row.id),
    ["assigned"],
  );
  assert.deepEqual(
    tasks.map((row) => row.id),
    ["later", "first", "assigned"],
  );
});
test("Взять можно свободное/своё queued или своё paused только работающим actor без другого active", () => {
  assert.equal(claimBlocked(task(), actor, []), null);
  assert.equal(
    claimBlocked(task({ employeeId: "actor", status: "paused" }), actor, []),
    null,
  );
  assert.ok(claimBlocked(task(), undefined, []));
  assert.ok(claimBlocked(task(), { ...actor, status: "off" }, []));
  assert.ok(claimBlocked(task({ employeeId: "other" }), actor, []));
  assert.ok(claimBlocked(task({ status: "paused" }), actor, []));
  assert.ok(
    claimBlocked(task(), actor, [
      task({ id: "other-active", status: "active", employeeId: "actor" }),
    ]),
  );
  assert.ok(
    claimBlocked(task({ status: "active", employeeId: "actor" }), actor, []),
  );
  assert.ok(claimBlocked(task({ status: "completed" }), actor, []));
});
test("Переназначение допускается только между коробами, source scan без подтверждённого короба не блокирует", () => {
  assert.equal(assignmentBlocked(task()), null);
  assert.equal(
    assignmentBlocked(
      task({ status: "paused", sourcePalletId: "raw-1", employeeId: "actor" }),
    ),
    null,
  );
  for (const patch of [
    { status: "active" as const },
    { status: "completed" as const },
    { scannedUnits: 1 },
    { boxCodeConfirmed: true },
  ])
    assert.ok(assignmentBlocked(task(patch)));
});
test("Цикл коробки: источник → короб → товары; новая партия в том же коробе снова требует source", () => {
  const active = task({ status: "active", employeeId: "actor" });
  assert.equal(assemblyStep(active), "source");
  assert.equal(assemblyStep({ ...active, sourcePalletId: "raw-1" }), "box");
  assert.equal(
    assemblyStep({
      ...active,
      sourcePalletId: "raw-1",
      boxCodeConfirmed: true,
    }),
    "items",
  );
  const mixed = {
    ...active,
    sourcePalletId: "raw-1",
    boxCodeConfirmed: true,
    scannedUnits: 10,
    reservations: [
      { lotId: "old", palletId: "raw-1", quantity: 0 },
      { lotId: "new", palletId: "raw-2", quantity: 30 },
    ],
  };
  assert.equal(nextSource(mixed)?.palletId, "raw-2");
  assert.equal(assemblyStep(mixed), "source");
  assert.equal(assemblyStep({ ...mixed, sourcePalletId: "raw-2" }), "items");
});
test("Новый короб и legacy полный различаются: recovery не появляется у обычного неполного короба", () => {
  const active = task({ status: "active", employeeId: "actor" });
  assert.equal(
    assemblyStep({
      ...active,
      scannedUnits: 20,
      boxCodeConfirmed: true,
      reservations: [],
    }),
    "recovery",
  );
  assert.equal(
    assemblyStep({
      ...active,
      scannedUnits: 19,
      boxCodeConfirmed: true,
      sourcePalletId: "raw-1",
    }),
    "items",
  );
  assert.equal(
    assemblyStep({
      ...active,
      boxesCompleted: 1,
      sourcePalletId: null,
      boxCodeConfirmed: false,
      scannedUnits: 0,
      openBoxCode: "BOX-002",
    }),
    "source",
  );
  assert.equal(assemblyStep(task({ status: "completed" })), "complete");
  assert.equal(assemblyStep(task({ status: "paused" })), "inactive");
});
test("Физическая подсказка 2×10 появляется только для 20 раскрасок и не меняет учёт", () => {
  assert.match(preparationHint(20), /2 упаковки по 10/);
  assert.match(preparationHint(12), /12 раскрасок/);
  assert.doesNotMatch(preparationHint(12), /2 упаковки/);
});

test("Сотрудник видит свои задания и свободную очередь, но не чужое назначение/паузу/историю", () => {
  for (const status of ["queued", "active", "paused", "completed"] as const) {
    assert.equal(
      assemblyTaskVisible(task({ status, employeeId: "actor" }), "actor"),
      true,
    );
    assert.equal(
      assemblyTaskVisible(task({ status, employeeId: "other" }), "actor"),
      false,
    );
  }
  assert.equal(assemblyTaskVisible(task(), "actor"), true);
  assert.equal(assemblyTaskVisible(task({ status: "paused" }), "actor"), false);
  assert.equal(assemblyTaskVisible(task(), ""), false);
  assert.ok(claimBlocked(task({ employeeId: "other" }), actor, []));
});
