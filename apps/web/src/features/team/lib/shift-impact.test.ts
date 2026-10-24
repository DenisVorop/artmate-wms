import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import {
  shiftStopBlocker,
  shiftStopImpact,
  shiftDuration,
} from "./shift-impact";
const workspace = (overrides: Partial<WorkspaceDto> = {}) =>
  ({
    tasks: [],
    putawayTasks: [],
    movements: [],
    ...overrides,
  }) as WorkspaceDto;
test("Остановить смену нельзя с собственным коробом или паллетой в пути; чужая работа не блокирует", () => {
  const data = workspace({
    movements: [
      { employeeId: "other", status: "in_transit", code: "M-OTHER" },
      { employeeId: "me", status: "planned", code: "M-PLAN" },
    ] as WorkspaceDto["movements"],
  });
  assert.equal(shiftStopBlocker(data, "me"), null);
  data.movements[1]!.status = "in_transit";
  assert.match(shiftStopBlocker(data, "me")!, /M-PLAN/);
  data.putawayTasks.push({
    employeeId: "me",
    status: "in_transit",
    code: "PUT-ME",
  } as WorkspaceDto["putawayTasks"][number]);
  assert.match(shiftStopBlocker(data, "me")!, /PUT-ME/);
});
test("Подсказка сообщает о паузе сборки и освобождении только взятого размещения", () => {
  const data = workspace({
    tasks: [{ employeeId: "me", status: "active" }] as WorkspaceDto["tasks"],
    putawayTasks: [
      { employeeId: "other", status: "claimed" },
    ] as WorkspaceDto["putawayTasks"],
  });
  assert.match(
    shiftStopImpact(data, "me"),
    /содержимое короба и резервы сохранятся/,
  );
  assert.doesNotMatch(shiftStopImpact(data, "me"), /свободную очередь/);
  data.putawayTasks[0]!.employeeId = "me";
  assert.match(shiftStopImpact(data, "me"), /свободную очередь/);
  data.tasks[0]!.status = "paused";
  assert.doesNotMatch(shiftStopImpact(data, "me"), /Сборка встанет/);
});
test("Продолжительность смены сохраняет часы после суток и не округляет секунды вверх", () => {
  assert.equal(shiftDuration(0), "0 мин");
  assert.equal(shiftDuration(3599), "59 мин");
  assert.equal(shiftDuration(90000), "25 ч 0 мин");
});
