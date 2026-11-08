import test from "node:test";
import assert from "node:assert/strict";
import type { TaskDto } from "@/shared/api/generated/model";
import {
  selectEmployeeAssembly,
  employeeAssemblyStep,
  employeeAssemblyScanContext,
  employeeAssemblyResult,
} from "./employee-assembly";
const task = (patch: Partial<TaskDto> = {}): TaskDto => ({
  id: "task",
  code: "TASK-01",
  skuId: "sku",
  employeeId: null,
  status: "queued",
  createdAt: "2026-10-24T08:00:00Z",
  boxesTarget: 10,
  boxesCompleted: 2,
  unitsPerBox: 20,
  scannedUnits: 0,
  sourcePalletId: null,
  boxCodeConfirmed: false,
  openBoxCode: "BOX-03",
  openBoxContents: [],
  reservations: [{ palletId: "raw", lotId: "lot", quantity: 160 }],
  ...patch,
});
test("own active/paused work outranks previews and foreign work is never selected", () => {
  const rows = [
    task({ id: "free", createdAt: null }),
    task({ id: "foreign", employeeId: "other", status: "active" }),
    task({ id: "own-queued", employeeId: "self" }),
    task({ id: "paused", employeeId: "self", status: "paused" }),
    task({ id: "active", employeeId: "self", status: "active" }),
  ];
  const copy = structuredClone(rows);
  assert.equal(selectEmployeeAssembly(rows, "self")?.id, "active");
  assert.equal(
    selectEmployeeAssembly(
      rows.filter((row) => row.id !== "active"),
      "self",
    )?.id,
    "paused",
  );
  assert.equal(
    selectEmployeeAssembly(
      rows.filter((row) => !["active", "paused"].includes(row.id)),
      "self",
    )?.id,
    "own-queued",
  );
  assert.equal(
    selectEmployeeAssembly(
      [
        task({ employeeId: "other", status: "paused" }),
        task({ status: "completed" }),
      ],
      "self",
    ),
    undefined,
  );
  assert.equal(selectEmployeeAssembly(rows, ""), undefined);
  assert.deepEqual(rows, copy);
});
test("the oldest own preview is stable and free work respects server ranking", () => {
  assert.equal(
    selectEmployeeAssembly(
      [
        task({ id: "free", createdAt: null }),
        task({ id: "new", employeeId: "self", createdAt: "2026-10-25" }),
        task({ id: "old", employeeId: "self", createdAt: "2026-10-23" }),
      ],
      "self",
    )?.id,
    "old",
  );
  assert.equal(
    selectEmployeeAssembly(
      [
        task({ id: "z", createdAt: null }),
        task({ id: "a", createdAt: null }),
        task({ id: "new" }),
      ],
      "self",
    )?.id,
    "z",
  );
});
test("source and unique box must be confirmed before items, including each newly reset box", () => {
  const active = task({ employeeId: "self", status: "active" });
  assert.equal(employeeAssemblyStep(active), "source");
  assert.equal(
    employeeAssemblyStep({ ...active, sourcePalletId: "raw" }),
    "box",
  );
  const items = {
    ...active,
    sourcePalletId: "raw",
    boxCodeConfirmed: true,
    scannedUnits: 12,
  };
  assert.equal(employeeAssemblyStep(items), "items");
  assert.equal(
    employeeAssemblyStep({
      ...items,
      boxesCompleted: 3,
      openBoxCode: "BOX-04",
      scannedUnits: 0,
      sourcePalletId: null,
      boxCodeConfirmed: false,
    }),
    "source",
  );
  assert.equal(
    employeeAssemblyScanContext(items),
    employeeAssemblyScanContext({ ...items, scannedUnits: 13 }),
  );
  assert.notEqual(
    employeeAssemblyScanContext(items),
    employeeAssemblyScanContext({ ...items, openBoxCode: "BOX-04" }),
  );
});
test("lot exhaustion requests the next source while retaining the confirmed partially filled box", () => {
  const active = task({
    employeeId: "self",
    status: "active",
    sourcePalletId: "raw",
    boxCodeConfirmed: true,
    scannedUnits: 10,
    reservations: [
      { palletId: "raw", lotId: "old", quantity: 0 },
      { palletId: "next", lotId: "new", quantity: 10 },
    ],
  });
  assert.equal(employeeAssemblyStep(active), "source");
  assert.match(employeeAssemblyScanContext(active), /next$/);
  assert.equal(
    employeeAssemblyStep({ ...active, sourcePalletId: "next" }),
    "items",
  );
});
test("only a confirmed legacy full box exposes recovery; pause and completion never become scans", () => {
  const full = task({
    status: "active",
    employeeId: "self",
    scannedUnits: 20,
    boxCodeConfirmed: true,
    reservations: [],
  });
  assert.equal(employeeAssemblyStep(full), "recovery");
  assert.equal(
    employeeAssemblyStep({ ...full, boxCodeConfirmed: false }),
    "source",
  );
  assert.equal(employeeAssemblyStep({ ...full, status: "paused" }), "resume");
  assert.equal(
    employeeAssemblyStep({ ...full, status: "completed" }),
    "complete",
  );
});
test("a committed snapshot chooses the next server-active assignment without claiming a queued preview", () => {
  const before = task({
    status: "active",
    employeeId: "self",
    boxesCompleted: 9,
    scannedUnits: 19,
  });
  const done = {
    ...before,
    status: "completed" as const,
    boxesCompleted: 10,
    scannedUnits: 0,
  };
  const next = task({
    id: "next",
    code: "TASK-02",
    status: "active",
    employeeId: "self",
  });
  assert.equal(selectEmployeeAssembly([done, next], "self"), next);
  assert.match(
    employeeAssemblyResult(before, [done, next], "self") ?? "",
    /Следующее — TASK-02/,
  );
  assert.match(
    employeeAssemblyResult(before, [done], "self") ?? "",
    /Возьмите следующее/,
  );
  assert.equal(
    employeeAssemblyResult(before, [{ ...before, scannedUnits: 20 }], "self"),
    null,
  );
});
