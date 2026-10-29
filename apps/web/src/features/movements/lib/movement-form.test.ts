import assert from "node:assert/strict";
import { test } from "node:test";
import {
  targetHint,
  toMovement,
  wholePalletMovementAllowed,
  movementTitle,
  movementClaimHint,
} from "./movement-form";

test("Общий накопитель не предлагается целиком; тематическая паллета с входящим резервом ждёт завершения размещения", () => {
  const data: Parameters<typeof wholePalletMovementAllowed>[0] = {
    putawayTasks: [
      {
        id: "task",
        code: "PUT-1",
        boxId: "box",
        skuId: "sku",
        status: "claimed",
        employeeId: "e",
        fromPalletId: "common",
        fromLocationId: "assembly",
        toLocationId: "target",
        createdAt: "2026-10-23T00:00:00Z",
        claimedAt: "2026-10-23T00:00:00Z",
        takenAt: null,
        completedAt: null,
      },
    ],
  };
  assert.equal(
    wholePalletMovementAllowed(data, {
      id: "common",
      kind: "assembly",
      locationId: "assembly",
    }),
    false,
  );
  assert.equal(
    wholePalletMovementAllowed(data, {
      id: "finished",
      kind: "finished",
      locationId: "target",
    }),
    false,
  );
  assert.equal(
    wholePalletMovementAllowed(data, {
      id: "finished",
      kind: "finished",
      locationId: "other",
    }),
    true,
  );
  assert.equal(
    wholePalletMovementAllowed(data, {
      id: "common",
      kind: "finished",
      locationId: "assembly",
    }),
    false,
  );
  data.putawayTasks[0].status = "completed";
  assert.equal(
    wholePalletMovementAllowed(data, {
      id: "finished",
      kind: "finished",
      locationId: "target",
    }),
    true,
  );
});

test("Менеджер назначает исполнителя; сотрудник создаёт перемещение только на себя даже со старым значением формы", () => {
  const values = {
    palletId: "pallet",
    toLocationId: "target",
    employeeId: "other",
    kind: "transfer" as const,
    keepSourceReserved: true,
  };
  assert.equal(
    toMovement(values, { employeeId: "self", role: "employee" }).employeeId,
    "self",
  );
  assert.equal(
    toMovement(values, { employeeId: "self", role: "manager" }).employeeId,
    "other",
  );
  assert.equal(
    toMovement(values, { employeeId: "self", role: "employee" })
      .keepSourceReserved,
    false,
  );
});

test("Обезличенные резервы запрещают чужие цели, но удерживаемый адрес своей паллеты доступен для возврата", () => {
  const location = {
    id: "target",
    code: "A-1",
    name: "Место",
    kind: "floor" as const,
    sectionId: null,
    level: 1,
    levels: 1,
    x: 0,
    y: 0,
    width: 1.3,
    depth: 0.9,
    rotation: 0 as const,
    archived: false,
    archivedAt: null,
    availableWidthMm: 1300,
    availableDepthMm: 900,
    maxHeightMm: 2000,
    maxBoxes: 18,
    maxWeightKg: null,
    accessSides: 1,
    blocked: false,
  };
  const pallet = {
    id: "pallet",
    code: "P-1",
    skuId: "sku",
    lotId: "lot",
    quantity: 20,
    locationId: "source",
    kind: "raw" as const,
    heightMm: 1500,
    widthMm: 1200,
    depthMm: 800,
    weightKg: null,
    status: "stored" as const,
    returnLocationId: null as string | null,
    packagingSnapshot: null,
  };
  const data: Parameters<typeof targetHint>[0] = {
    locations: [location],
    pallets: [pallet],
    movements: [],
    putawayTasks: [],
    addressHolds: [],
  };
  assert.equal(targetHint(data, "target", pallet, "transfer"), null);
  for (const kind of ["movement", "putaway", "return"] as const) {
    data.addressHolds = [{ locationId: "target", kind }];
    assert.ok(targetHint(data, "target", pallet, "transfer"));
  }
  data.addressHolds = [{ locationId: "target", kind: "return" }];
  pallet.returnLocationId = "target";
  assert.equal(targetHint(data, "target", pallet, "return"), null);
  assert.ok(targetHint(data, "target", pallet, "transfer"));
  data.addressHolds = [{ locationId: "source", kind: "putaway" }];
  assert.equal(wholePalletMovementAllowed(data, pallet), false);
});

test("automatic lowering title stays distinct from manual picking and claim explains an unavailable shift", () => {
  assert.equal(
    movementTitle({ kind: "transfer", autoPurpose: "accessible_raw" }),
    "Спустить сырьё ниже",
  );
  assert.equal(movementTitle({ kind: "lower" }), "Спуск для отбора");
  const data: Parameters<typeof movementClaimHint>[0] = {
    employees: [{ id: "self", status: "working" }] as Parameters<
      typeof movementClaimHint
    >[0]["employees"],
    tasks: [],
    putawayTasks: [],
    movements: [],
    shipments: [],
  };
  assert.equal(movementClaimHint(data, "self", "move"), null);
  assert.match(movementClaimHint(data, undefined, "move") ?? "", /смену/);
  data.tasks = [
    { employeeId: "self", status: "paused", scannedUnits: 1 },
  ] as Parameters<typeof movementClaimHint>[0]["tasks"];
  assert.match(movementClaimHint(data, "self", "move") ?? "", /открытый короб/);
});
