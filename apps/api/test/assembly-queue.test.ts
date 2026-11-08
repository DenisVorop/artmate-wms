import assert from "node:assert/strict";
import { test } from "node:test";
import { assemblyQueueOrder } from "../src/assembly-queue";
import type { TaskDto } from "../src/dto";

test("a theme just started yields to another urgent theme, while backlog waits", () => {
  const task = (id: string, skuId: string, patch: Partial<TaskDto> = {}) =>
    ({
      id,
      skuId,
      employeeId: null,
      status: "queued",
      createdAt: "2026-11-08T09:00:00Z",
      ...patch,
    }) as TaskDto;
  const backlog = task("a", "backlog", { autoPurpose: "backlog" });
  const anotherA = task("b", "A", { autoPurpose: "urgent" });
  const urgentB = task("c", "B", { autoPurpose: "urgent" });
  const activeA = task("started", "A", {
    status: "active",
    startedAt: "2026-11-08T10:00:00Z",
  });
  const all = [backlog, anotherA, urgentB, activeA];
  assert.deepEqual(
    all
      .filter((candidate) => candidate.status === "queued")
      .sort(assemblyQueueOrder(all, "employee"))
      .map((candidate) => candidate.id),
    ["c", "b", "a"],
  );
});
