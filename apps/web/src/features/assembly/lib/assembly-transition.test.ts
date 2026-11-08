import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskDto } from "@/shared/api/generated/model";
import { afterAssemblyCommand } from "./assembly-transition";
const task = (patch: Partial<TaskDto> = {}): TaskDto => ({
  id: "job-1",
  code: "JOB-001",
  skuId: "sku",
  employeeId: "actor",
  status: "active",
  createdAt: null,
  boxesTarget: 2,
  boxesCompleted: 0,
  unitsPerBox: 20,
  scannedUnits: 19,
  sourcePalletId: "raw-1",
  boxCodeConfirmed: true,
  openBoxCode: "BOX-001",
  openBoxContents: [],
  reservations: [],
  ...patch,
});
test("Следующий короб того же задания выбирается из response без клиентских pack/claim", () => {
  const before = task();
  const after = task({
    boxesCompleted: 1,
    scannedUnits: 0,
    sourcePalletId: null,
    boxCodeConfirmed: false,
    openBoxCode: "BOX-002",
  });
  const transition = afterAssemblyCommand(before, [after], "actor");
  assert.equal(transition.kind, "box");
  assert.equal(transition.selectedId, before.id);
  assert.equal(transition.tab, "active");
  assert.match(transition.notice, /BOX-002/);
  assert.match(transition.notice, /источник/);
});
test("После завершения выбирается только уже активированное сервером задание того же actor", () => {
  const before = task({ boxesCompleted: 1 });
  const done = task({ status: "completed", boxesCompleted: 2 });
  const next = task({
    id: "next",
    code: "JOB-002",
    scannedUnits: 0,
    boxCodeConfirmed: false,
    sourcePalletId: null,
  });
  const others = [
    task({ id: "paused", status: "paused" }),
    task({ id: "foreign", employeeId: "other" }),
    task({ id: "free", status: "queued", employeeId: null }),
  ];
  const transition = afterAssemblyCommand(
    before,
    [done, ...others, next],
    "actor",
  );
  assert.equal(transition.kind, "next");
  assert.equal(transition.selectedId, "next");
  assert.match(transition.notice, /JOB-001.*JOB-002/);
});
test("Пустая/недоступная очередь явно завершает работу, paused и чужое active не забираются UI", () => {
  const before = task({ boxesCompleted: 1 });
  const done = task({ status: "completed", boxesCompleted: 2 });
  const transition = afterAssemblyCommand(
    before,
    [
      done,
      task({ id: "paused", status: "paused" }),
      task({ id: "foreign", employeeId: "other" }),
      task({ id: "queued", status: "queued", employeeId: null }),
    ],
    "actor",
  );
  assert.equal(transition.kind, "complete");
  assert.equal(transition.selectedId, done.id);
  assert.equal(transition.tab, "completed");
  assert.match(transition.notice, /взять из очереди/);
});
test("Обычный скан и replay без изменения не сообщают о новом коробе или лишней единице", () => {
  const before = task({ scannedUnits: 8 });
  assert.equal(
    afterAssemblyCommand(before, [task({ scannedUnits: 9 })], "actor").kind,
    "scan",
  );
  const replay = afterAssemblyCommand(before, [before], "actor");
  assert.equal(replay.kind, "unchanged");
  assert.doesNotMatch(replay.notice, /Раскраска учтена|Короб закрыт/);
  assert.equal(before.scannedUnits, 8);
});
