import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { employeeScanTask } from "./scan-task";
const data = () =>
  ({ tasks: [], putawayTasks: [], shipments: [] }) as unknown as WorkspaceDto;
const pool = {
  zoneId: "putaway-zone",
  assignment: { jobKind: "putaway", jobId: "putaway-zone" },
} as const;
test("a free box selection has no task audit until the server resolves and assigns the scanned box", () => {
  const state = data();
  state.putawayTasks = [
    { id: "box-task", status: "queued", employeeId: null },
  ] as WorkspaceDto["putawayTasks"];
  assert.equal(employeeScanTask(state, "marina", "putaway", pool), undefined);
  // takeAnyPutawayBox replaces the zone placeholder with the actual carry.
  Object.assign(state.putawayTasks[0], {
    employeeId: "marina",
    status: "in_transit",
  });
  assert.deepEqual(
    employeeScanTask(state, "marina", "putaway", {
      ...pool,
      assignment: { jobKind: "putaway", jobId: "box-task" },
    }),
    { kind: "putaway", id: "box-task" },
  );
  // Completion returns the employee to the unselected box pool.
  Object.assign(state.putawayTasks[0], { status: "completed" });
  assert.equal(employeeScanTask(state, "marina", "putaway", pool), undefined);
});
test("concrete and resumed own assignments keep their audit references", () => {
  const state = data();
  for (const kind of ["assembly", "receiving", "shipping", "putaway"] as const)
    assert.deepEqual(
      employeeScanTask(state, "marina", kind, {
        zoneId: "zone",
        assignment: { jobKind: kind, jobId: "job" },
      }),
      { kind, id: "job" },
    );
  state.putawayTasks = [
    { id: "own", status: "in_transit", employeeId: "marina" },
    { id: "foreign", status: "in_transit", employeeId: "other" },
  ] as WorkspaceDto["putawayTasks"];
  assert.deepEqual(employeeScanTask(state, "marina", "putaway", {}), {
    kind: "putaway",
    id: "own",
  });
  assert.equal(employeeScanTask(state, "nobody", "putaway", {}), undefined);
});
test("inventory and movement references are unaffected by a previously selected zone", () => {
  assert.deepEqual(
    employeeScanTask(data(), "marina", "stocktakes", {
      ...pool,
      stocktakeId: "inventory",
    }),
    { kind: "stocktake", id: "inventory" },
  );
  assert.deepEqual(
    employeeScanTask(data(), "marina", "movements", {
      ...pool,
      movementId: "move",
    }),
    { kind: "movement", id: "move" },
  );
});
