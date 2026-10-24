import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  BoxDto,
  LocationDto,
  PalletDto,
  PackagingProfileDto,
  TaskDto,
  MovementDto,
  PutawayTaskDto,
} from "@/shared/api/generated/model";
import {
  adjustmentSnapshotChanged,
  captureAdjustmentSnapshot,
  eligibleAdjustmentTargets,
} from "./adjustment-targets";
import {
  adjustmentDefaults,
  adjustmentSchemaFor,
  toStockAdjustment,
} from "./adjustment-form";

const profile: PackagingProfileDto = {
  boxWidthMm: 400,
  boxDepthMm: 400,
  boxHeightMm: 300,
  palletWidthMm: 1200,
  palletDepthMm: 800,
  palletBaseHeightMm: 150,
  boxesPerLayer: 6,
  maxLayers: 6,
  boxWeightKg: null,
  palletWeightKg: null,
};
const location: LocationDto = {
  id: "location",
  code: "A-01",
  name: "Хранение",
  kind: "floor",
  sectionId: null,
  level: 1,
  levels: 1,
  x: 0,
  y: 0,
  width: 1.3,
  depth: 0.9,
  rotation: 0,
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
const pallet: PalletDto = {
  id: "raw",
  code: "RAW-01",
  skuId: "sku",
  lotId: "lot",
  quantity: 100,
  locationId: "location",
  kind: "raw",
  heightMm: 1500,
  widthMm: 1200,
  depthMm: 800,
  weightKg: null,
  status: "stored",
  returnLocationId: null,
  packagingSnapshot: null,
};
const finished: PalletDto = {
  ...pallet,
  id: "finished",
  code: "FG-01",
  kind: "finished",
  quantity: 1,
  lotId: null,
  packagingSnapshot: profile,
};
const box: BoxDto = {
  id: "box",
  code: "BOX-01",
  skuId: "sku",
  units: 20,
  lotContents: [{ lotId: "lot", quantity: 20 }],
  packedAt: "2026-10-24T00:00:00Z",
  locationId: "location",
  palletId: "finished",
  status: "stored",
  packagingSnapshot: profile,
};
function source(): Parameters<typeof captureAdjustmentSnapshot>[0] {
  return {
    pallets: [{ ...pallet }, { ...finished }],
    boxes: [structuredClone(box)],
    locations: [{ ...location }],
    sections: [],
    tasks: [],
    movements: [],
    putawayTasks: [],
    shipments: [],
    skus: [
      {
        id: "sku",
        code: "SKU-01",
        name: "Котики",
        barcode: "123",
        unitsPerBox: 20,
        color: "green",
        packaging: profile,
      },
    ],
    lots: [
      { id: "lot", skuId: "sku", receivedAt: box.packedAt, name: "Первая" },
    ],
  };
}
const movement: MovementDto = {
  id: "move",
  code: "MOVE",
  palletId: "raw",
  fromLocationId: "location",
  toLocationId: "target",
  kind: "transfer",
  keepSourceReserved: false,
  status: "planned",
  employeeId: "worker",
  createdAt: box.packedAt,
  takenAt: null,
  completedAt: null,
};
const putaway: PutawayTaskDto = {
  id: "put",
  code: "PUT",
  boxId: "other",
  skuId: "sku",
  status: "claimed",
  employeeId: "worker",
  fromPalletId: "assembly",
  fromLocationId: "assembly",
  toLocationId: "location",
  createdAt: box.packedAt,
  claimedAt: box.packedAt,
  takenAt: null,
  completedAt: null,
};

test("Пересчёт исключает ожидающие размещения, движения, резервы, блокировки и неизвестные партии; нулевой остаток допустим", () => {
  for (const change of [
    (d: ReturnType<typeof source>) => {
      d.pallets[0].status = "awaiting_placement";
    },
    (d: ReturnType<typeof source>) => {
      d.pallets[0].lotId = null;
    },
    (d: ReturnType<typeof source>) => {
      d.pallets[0].skuId = "unknown";
    },
    (d: ReturnType<typeof source>) => {
      d.locations[0].blocked = true;
    },
    (d: ReturnType<typeof source>) => {
      d.locations[0].archived = true;
    },
    (d: ReturnType<typeof source>) => {
      d.locations[0].sectionId = "missing-archived-section";
    },
    (d: ReturnType<typeof source>) => {
      d.movements.push({ ...movement });
    },
    (d: ReturnType<typeof source>) => {
      d.putawayTasks.push({ ...putaway });
    },
    (d: ReturnType<typeof source>) => {
      d.tasks.push({
        id: "task",
        code: "TASK",
        skuId: "sku",
        boxesTarget: 1,
        boxesCompleted: 0,
        unitsPerBox: 20,
        status: "queued",
        employeeId: null,
        scannedUnits: 0,
        sourcePalletId: null,
        openBoxCode: "OPEN",
        reservations: [{ palletId: "raw", lotId: "lot", quantity: 20 }],
        openBoxContents: [],
        createdAt: null,
        boxCodeConfirmed: false,
      } satisfies TaskDto);
    },
  ]) {
    const d = source();
    change(d);
    assert.equal(captureAdjustmentSnapshot(d, "raw_count", "raw"), null);
  }
  const d = source();
  d.pallets[0].quantity = 0;
  assert.equal(
    captureAdjustmentSnapshot(d, "raw_count", "raw")?.expectedQuantity,
    0,
  );
});
test("Списание доступно на picking, но не для накопления, отгрузочного резерва, размещения или движения", () => {
  const allowed = source();
  allowed.locations[0].kind = "picking";
  assert.equal(eligibleAdjustmentTargets(allowed, "box_writeoff").length, 1);
  for (const change of [
    (d: ReturnType<typeof source>) => {
      d.pallets[1].kind = "assembly";
    },
    (d: ReturnType<typeof source>) => {
      d.locations[0].kind = "assembly";
    },
    (d: ReturnType<typeof source>) => {
      d.boxes[0].status = "written_off";
    },
    (d: ReturnType<typeof source>) => {
      d.boxes[0].status = "in_transit";
    },
    (d: ReturnType<typeof source>) => {
      d.boxes[0].lotContents[0].quantity = 10;
    },
    (d: ReturnType<typeof source>) => {
      d.movements.push({
        ...movement,
        palletId: "finished",
        status: "in_transit",
      });
    },
    (d: ReturnType<typeof source>) => {
      d.putawayTasks.push({
        ...putaway,
        fromPalletId: "finished",
        toLocationId: null,
        status: "queued",
      });
    },
    (d: ReturnType<typeof source>) => {
      d.shipments.push({
        id: "shipment",
        code: "SHIP",
        skuId: "sku",
        boxesRequested: 1,
        status: "draft",
        boxIds: ["box"],
      });
    },
  ]) {
    const d = source();
    change(d);
    assert.equal(captureAdjustmentSnapshot(d, "box_writeoff", "box"), null);
  }
});
test("Ожидание фиксируется при выборе и не подменяется серверным polling; явный новый снимок видит изменение", () => {
  const d = source(),
    snapshot = captureAdjustmentSnapshot(d, "raw_count", "raw")!;
  d.pallets[0].quantity = 90;
  assert.match(adjustmentSnapshotChanged(d, snapshot)!, /90/);
  assert.equal(snapshot.expectedQuantity, 100);
  assert.equal(
    captureAdjustmentSnapshot(d, "raw_count", "raw")?.expectedQuantity,
    90,
  );
  d.pallets[0].locationId = "elsewhere";
  assert.match(adjustmentSnapshotChanged(d, snapshot)!, /адрес/);
  assert.equal(snapshot.expectedLocationId, "location");
  const dto = toStockAdjustment(
    {
      ...adjustmentDefaults,
      targetId: "raw",
      employeeId: "worker",
      countedQuantity: 80,
      reason: "  Недостача при пересчёте  ",
    },
    snapshot,
    "request",
  );
  assert.deepEqual(dto, {
    requestId: "request",
    kind: "raw_count",
    targetId: "raw",
    employeeId: "worker",
    expectedLocationId: "location",
    expectedQuantity: 100,
    countedQuantity: 80,
    reason: "Недостача при пересчёте",
  });
});
test("Схема отклоняет no-op, дроби, отрицательные и чрезмерные числа, короткую причину; короб только 1→0", () => {
  const d = source(),
    snapshot = captureAdjustmentSnapshot(d, "raw_count", "raw")!;
  const values = {
    ...adjustmentDefaults,
    targetId: "raw",
    employeeId: "worker",
    countedQuantity: 90,
    reason: "Пересчёт",
  };
  for (const countedQuantity of [100, -1, 0.5, 100000001, NaN, Infinity])
    assert.equal(
      adjustmentSchemaFor(snapshot).safeParse({ ...values, countedQuantity })
        .success,
      false,
    );
  assert.equal(
    adjustmentSchemaFor(snapshot).safeParse({ ...values, reason: "    " })
      .success,
    false,
  );
  assert.equal(
    adjustmentSchemaFor(snapshot).safeParse({
      ...values,
      reason: "x".repeat(501),
    }).success,
    false,
  );
  assert.throws(() =>
    toStockAdjustment({ ...values, targetId: "another" }, snapshot),
  );
  const boxSnapshot = captureAdjustmentSnapshot(d, "box_writeoff", "box")!;
  const boxValues = {
    ...values,
    kind: "box_writeoff" as const,
    targetId: "box",
    countedQuantity: 0,
  };
  const dto = toStockAdjustment(boxValues, boxSnapshot, "box-request");
  assert.equal(dto.expectedQuantity, 1);
  assert.equal(dto.countedQuantity, 0);
  assert.equal(
    adjustmentSchemaFor(boxSnapshot).safeParse({
      ...boxValues,
      countedQuantity: 1,
    }).success,
    false,
  );
});
