import { test } from "node:test";
import assert from "node:assert/strict";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { employeeMode, employeePriority } from "./workday";
const data = (patch: Partial<WorkspaceDto> = {}) =>
  ({ putawayTasks: [], movements: [], tasks: [], ...patch }) as WorkspaceDto;
test("work hub prioritizes an own physical carry over active assembly and other requested work", () => {
  const s = data({
    putawayTasks: [
      { employeeId: "self", status: "in_transit" },
    ] as WorkspaceDto["putawayTasks"],
    tasks: [{ employeeId: "self", status: "active" }] as WorkspaceDto["tasks"],
  });
  assert.deepEqual(employeePriority(s, "self"), {
    mode: "putaway",
    carrying: true,
  });
});
test("foreign jobs and free secondary work never force an employee away from explicit choice", () => {
  const s = data({
    putawayTasks: [
      { employeeId: null, status: "queued" },
      { employeeId: "other", status: "in_transit" },
    ] as WorkspaceDto["putawayTasks"],
    movements: [
      { employeeId: "other", status: "planned" },
    ] as WorkspaceDto["movements"],
  });
  assert.equal(employeePriority(s, "self"), null);
});
test("a claimed secondary job and an assigned planned movement remain resumable without claiming another", () => {
  const s = data({
    putawayTasks: [
      { employeeId: "self", status: "claimed" },
    ] as WorkspaceDto["putawayTasks"],
    movements: [
      { employeeId: "self", status: "planned" },
    ] as WorkspaceDto["movements"],
  });
  assert.deepEqual(employeePriority(s, "self"), {
    mode: "putaway",
    carrying: false,
  });
  s.putawayTasks = [];
  assert.deepEqual(employeePriority(s, "self"), {
    mode: "movements",
    carrying: false,
  });
});
test("arbitrary deep link modes do not expose manager features", () => {
  assert.equal(employeeMode("inventory"), "zone");
  assert.equal(employeeMode("receiving"), "receiving");
  assert.equal(employeeMode(undefined), "zone");
});
