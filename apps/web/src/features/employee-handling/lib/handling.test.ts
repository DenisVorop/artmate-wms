import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  MovementDto,
  PutawayTaskDto,
  ReceiptDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import {
  matchesScan,
  selectMovement,
  selectPutaway,
  selectReceipt,
  workBlock,
  putawayWork,
} from "./handling";
const put = (
  id: string,
  status: PutawayTaskDto["status"],
  employeeId: string | null,
  createdAt = "2026-10-24T10:00:00Z",
): PutawayTaskDto => ({
  id,
  code: id,
  status,
  employeeId,
  createdAt,
  boxId: "box",
  skuId: "sku",
  fromPalletId: "p",
  fromLocationId: "a",
  toLocationId: "b",
  claimedAt: null,
  takenAt: null,
  completedAt: null,
});
const move = (
  id: string,
  status: MovementDto["status"],
  employeeId = "me",
): MovementDto => ({
  id,
  code: id,
  status,
  employeeId,
  palletId: "p",
  fromLocationId: "a",
  toLocationId: "b",
  createdAt: "2026-10-24T10:00:00Z",
  kind: "transfer",
  keepSourceReserved: false,
  takenAt: null,
  completedAt: null,
});
const receipt = (
  id: string,
  receivedAt: string,
  placed = false,
): ReceiptDto => ({
  id,
  code: id,
  receivedAt,
  createdAt: receivedAt,
  status: placed ? "completed" : "awaiting_placement",
  completedAt: null,
  pallets: [
    {
      palletId: id,
      skuId: "sku",
      quantity: 1000,
      locationId: null,
      placedAt: placed ? receivedAt : null,
      placedByEmployeeId: null,
    },
  ],
});
const scope = (): Pick<
  WorkspaceDto,
  "employees" | "tasks" | "movements" | "putawayTasks"
> => ({
  employees: [
    {
      id: "me",
      name: "Я",
      initials: "Я",
      role: "",
      status: "working",
      boxesToday: 0,
      unitsToday: 0,
    },
  ],
  tasks: [],
  movements: [],
  putawayTasks: [],
});
test("putaway prioritizes own carrying then claimed over voluntary oldest; never foreign or anonymous actor", () => {
  const queued = put("q", "queued", null, "2026-10-24T09:00:00Z"),
    claimed = put("c", "claimed", "me"),
    carrying = put("t", "in_transit", "me");
  const tasks = [
    put("foreign", "in_transit", "other"),
    queued,
    claimed,
    carrying,
  ];
  assert.equal(selectPutaway(tasks, "me")?.id, "t");
  assert.equal(
    selectPutaway(
      tasks.filter((t) => t !== carrying),
      "me",
    )?.id,
    "c",
  );
  assert.equal(
    selectPutaway([queued, put("new", "queued", null)], "me")?.id,
    "q",
  );
  assert.equal(selectPutaway(tasks, ""), undefined);
  assert.equal(tasks[0].id, "foreign");
});
test("movement execution only own active jobs, carrying before planned and no array mutation", () => {
  const tasks = [
    move("foreign", "in_transit", "other"),
    move("planned", "planned"),
    move("carrying", "in_transit"),
    move("done", "completed"),
  ];
  assert.equal(selectMovement(tasks, "me")?.id, "carrying");
  assert.equal(selectMovement(tasks, "missing"), undefined);
  assert.equal(tasks[0].id, "foreign");
});
test("receiving chooses oldest actual receipt with pending pallets; completed omitted", () => {
  const early = receipt("old", "2026-10-23T09:00:00Z");
  assert.equal(
    selectReceipt([
      receipt("done", "2026-10-22", true),
      receipt("new", "2026-10-24"),
      early,
    ])?.id,
    "old",
  );
});
test("first scan accepts exact physical code or correct typed QR; never another object/type", () => {
  assert.equal(matchesScan(" PAL-1 ", "pallet", "id1", "PAL-1"), true);
  assert.equal(
    matchesScan("artmate-wms:pallet:id1", "pallet", "id1", "PAL-1"),
    true,
  );
  assert.equal(
    matchesScan("artmate-wms:pallet:id2", "pallet", "id1", "PAL-1"),
    false,
  );
  assert.equal(
    matchesScan("artmate-wms:location:id1", "pallet", "id1", "PAL-1"),
    false,
  );
  assert.equal(
    matchesScan("artmate-wms:box:BOX-1", "box", "BOX-1", "BOX-1"),
    true,
  );
});
test("carrying cannot be hidden by switching to receipt/movement work; current carrying job remains actionable", () => {
  const data = scope();
  data.putawayTasks = [put("carry", "in_transit", "me")];
  assert.match(workBlock(data, "me", "receiving") ?? "", /уже у вас/);
  assert.match(workBlock(data, "me", "movement") ?? "", /уже у вас/);
  assert.equal(workBlock(data, "me", "putaway", "carry"), null);
  data.putawayTasks = [];
  data.movements = [move("carry", "in_transit")];
  assert.match(workBlock(data, "me", "receiving") ?? "", /уже у вас/);
  assert.equal(workBlock(data, "me", "movement", "carry"), null);
});
test("off-shift and incompatible planned movement prevent voluntary claim", () => {
  const data = scope();
  data.employees[0].status = "break";
  assert.match(workBlock(data, "me", "putaway") ?? "", /смену/);
  data.employees[0].status = "working";
  data.movements = [move("planned", "planned")];
  assert.match(workBlock(data, "me", "putaway", "queued") ?? "", /перемещение/);
});
test("idle putaway zone asks for any box without selecting an arbitrary queued assignment", () => {
  const data = {
    putawayTasks: [put("first", "queued", null), put("second", "queued", null)],
    warehouse: {
      zoneWork: [
        {
          employeeId: "me",
          zoneId: "put",
          jobId: null,
          jobKind: null,
          palletId: null,
          message: "",
        },
      ],
      workZones: [
        {
          id: "put",
          code: "PUT",
          name: "Размещение",
          kind: "putaway",
          locationIds: [],
          archived: false,
          archivedAt: null,
        },
      ],
    },
  } as unknown as Pick<WorkspaceDto, "warehouse" | "putawayTasks">;
  assert.equal(putawayWork(data, "me").kind, "take");
  assert.equal(putawayWork(data, "other").kind, "zone");
  assert.equal(putawayWork(data, "").kind, "zone");
  data.warehouse.workZones[0].archived = true;
  assert.equal(putawayWork(data, "me").kind, "zone");
});
test("refresh resumes own server-confirmed carried box before zone selection; queued, claimed or foreign boxes are never treated as carried", () => {
  const data = {
    putawayTasks: [
      put("foreign", "in_transit", "other"),
      put("old-claim", "claimed", "me"),
      put("mine", "in_transit", "me"),
    ],
    warehouse: { zoneWork: [], workZones: [] },
  } as unknown as Pick<WorkspaceDto, "warehouse" | "putawayTasks">;
  const work = putawayWork(data, "me");
  assert.equal(work.kind, "place");
  assert.equal(work.kind === "place" ? work.task.id : null, "mine");
  data.putawayTasks = data.putawayTasks.filter((task) => task.id !== "mine");
  assert.equal(putawayWork(data, "me").kind, "zone");
});
