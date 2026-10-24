import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  EmployeeDto,
  MovementDto,
  PutawayTaskDto,
  TaskDto,
} from "@/shared/api/generated/model";
import {
  canReleasePutaway,
  canWorkPutaway,
  isActivePutaway,
  putawayClaimBlocked,
  putawayQueue,
} from "./putaway-queue";
const actor: EmployeeDto = {
  id: "actor",
  name: "Анна",
  initials: "А",
  role: "Сборщик",
  status: "working",
  boxesToday: 0,
  unitsToday: 0,
};
const task = (patch: Partial<PutawayTaskDto> = {}): PutawayTaskDto => ({
  id: "put-1",
  code: "PUT-001",
  boxId: "box-1",
  skuId: "cats",
  status: "queued",
  employeeId: null,
  fromPalletId: "common-pallet",
  fromLocationId: "assembly-address",
  toLocationId: null,
  createdAt: "2024-01-01T12:00:00Z",
  claimedAt: null,
  takenAt: null,
  completedAt: null,
  ...patch,
});
const primary = (patch: Partial<TaskDto> = {}): TaskDto => ({
  id: "job",
  code: "JOB-001",
  skuId: "cats",
  boxesTarget: 2,
  boxesCompleted: 0,
  unitsPerBox: 20,
  status: "active",
  employeeId: "actor",
  scannedUnits: 7,
  sourcePalletId: "raw-pallet",
  openBoxCode: "BOX-OPEN",
  boxCodeConfirmed: true,
  createdAt: null,
  reservations: [],
  openBoxContents: [],
  ...patch,
});
const movement = (patch: Partial<MovementDto> = {}): MovementDto => ({
  id: "movement",
  code: "MOV-001",
  palletId: "pallet",
  fromLocationId: "from",
  toLocationId: "to",
  employeeId: "actor",
  kind: "transfer",
  status: "planned",
  keepSourceReserved: false,
  createdAt: "2024-01-01",
  takenAt: null,
  completedAt: null,
  ...patch,
});
const empty = () => ({
  tasks: [] as TaskDto[],
  movements: [] as MovementDto[],
  putawayTasks: [] as PutawayTaskDto[],
});
test("Очередь — свободные короба, мои — только claimed/in_transit своего actor, история — completed", () => {
  const queued = task();
  const claimed = task({ id: "claim", status: "claimed", employeeId: "actor" });
  const carrying = task({
    id: "carry",
    status: "in_transit",
    employeeId: "actor",
  });
  const foreign = task({ id: "other", status: "claimed", employeeId: "other" });
  const done = task({
    id: "done",
    status: "completed",
    employeeId: "actor",
    completedAt: "2024-01-02T12:00:00Z",
  });
  const data = {
    putawayTasks: [queued, claimed, carrying, foreign, done],
    boxes: [{ id: "box-1", code: "BOX-001" }],
    skus: [{ id: "cats", name: "Котики-2" }],
  };
  assert.deepEqual(
    putawayQueue(data, "queued", "actor").map((t) => t.id),
    ["put-1"],
  );
  assert.deepEqual(
    putawayQueue(data, "mine", "actor").map((t) => t.id),
    ["carry", "claim"],
  );
  assert.equal(putawayQueue(data, "mine", "").length, 0);
  assert.deepEqual(
    putawayQueue(data, "completed", "other").map((t) => t.id),
    ["done"],
  );
  assert.deepEqual(
    putawayQueue(data, "queued", "actor", "КОТИКИ").map((t) => t.id),
    ["put-1"],
  );
  assert.equal(putawayQueue(data, "queued", "actor", "box-001").length, 1);
  assert.equal(putawayQueue(data, "queued", "actor", "put-001").length, 1);
  assert.equal(data.putawayTasks[0], queued);
});
test("История сортируется по факту завершения, без изменения текущих физических адресов", () => {
  const tasks = [
    task({ id: "older", status: "completed", completedAt: "2024-01-01" }),
    task({ id: "newer", status: "completed", completedAt: "2024-01-03" }),
  ];
  assert.deepEqual(
    putawayQueue(
      { putawayTasks: tasks, boxes: [], skus: [] },
      "completed",
      "",
    ).map((t) => t.id),
    ["newer", "older"],
  );
  assert.equal(tasks[0].id, "older");
  assert.equal(tasks[0].fromLocationId, "assembly-address");
});
test("Активная основная сборка блокирует добровольное взятие с явным путём паузы, но не изменяется клиентом", () => {
  const job = primary();
  const state = { ...empty(), tasks: [job] };
  const block = putawayClaimBlocked(task(), actor, state);
  assert.equal(block?.href, "/assembly");
  assert.match(block?.message ?? "", /JOB-001/);
  assert.match(block?.message ?? "", /паузу/);
  assert.equal(job.status, "active");
  assert.equal(job.scannedUnits, 7);
  assert.equal(
    putawayClaimBlocked(task(), actor, {
      ...empty(),
      tasks: [primary({ status: "paused" })],
    }),
    null,
  );
  assert.equal(
    putawayClaimBlocked(task(), actor, {
      ...empty(),
      tasks: [primary({ employeeId: "other" })],
    }),
    null,
  );
});
test("Нет actor/смены, чужое уже взятое и завершённое задания не дают ложного захвата", () => {
  assert.equal(putawayClaimBlocked(task(), undefined, empty())?.href, "/team");
  assert.ok(putawayClaimBlocked(task(), { ...actor, status: "off" }, empty()));
  assert.ok(
    putawayClaimBlocked(
      task({ status: "claimed", employeeId: "other" }),
      actor,
      empty(),
    ),
  );
  assert.ok(putawayClaimBlocked(task({ status: "completed" }), actor, empty()));
  assert.equal(putawayClaimBlocked(task(), actor, empty()), null);
});
test("Сотрудник не совмещает перемещение паллеты или другое размещение с новым коробом", () => {
  for (const status of ["planned", "in_transit"] as const)
    assert.equal(
      putawayClaimBlocked(task(), actor, {
        ...empty(),
        movements: [movement({ status })],
      })?.href,
      "/movements",
    );
  assert.equal(
    putawayClaimBlocked(task(), actor, {
      ...empty(),
      movements: [movement({ status: "completed" })],
    }),
    null,
  );
  for (const status of ["claimed", "in_transit"] as const)
    assert.ok(
      putawayClaimBlocked(task(), actor, {
        ...empty(),
        putawayTasks: [task({ id: "other", status, employeeId: "actor" })],
      }),
    );
  assert.equal(
    putawayClaimBlocked(task(), actor, {
      ...empty(),
      putawayTasks: [
        task({ id: "done", status: "completed", employeeId: "actor" }),
      ],
    }),
    null,
  );
});
test("Вернуть в очередь можно только своё claimed на смене, короб в руках требует place", () => {
  const claimed = task({ status: "claimed", employeeId: "actor" });
  const carry = { ...claimed, status: "in_transit" as const };
  assert.equal(canWorkPutaway(claimed, actor), true);
  assert.equal(canReleasePutaway(claimed, actor), true);
  assert.equal(canWorkPutaway(carry, actor), true);
  assert.equal(canReleasePutaway(carry, actor), false);
  for (const candidate of [
    undefined,
    { ...actor, status: "off" as const },
    { ...actor, id: "other" },
  ])
    assert.equal(canReleasePutaway(claimed, candidate), false);
  assert.equal(
    canReleasePutaway(
      task({ status: "completed", employeeId: "actor" }),
      actor,
    ),
    false,
  );
  assert.equal(isActivePutaway(task()), false);
});
