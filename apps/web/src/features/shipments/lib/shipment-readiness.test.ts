import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  BoxDto,
  LocationDto,
  PalletDto,
  PutawayTaskDto,
} from "@/shared/api/generated/model";
import { isShipmentBoxAvailable } from "./shipment-readiness";

const profile = {
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
  id: "target",
  code: "A-1",
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
  id: "pallet",
  code: "FG-1",
  skuId: "sku",
  kind: "finished",
  quantity: 1,
  lotId: null,
  locationId: "target",
  status: "stored",
  returnLocationId: null,
  packagingSnapshot: profile,
  widthMm: 1200,
  depthMm: 800,
  heightMm: 450,
  weightKg: null,
};
const box: BoxDto = {
  id: "box",
  code: "BOX-1",
  skuId: "sku",
  units: 20,
  lotContents: [{ lotId: "lot", quantity: 20 }],
  packedAt: "2026-10-23T00:00:00Z",
  locationId: "target",
  palletId: "pallet",
  status: "stored",
  packagingSnapshot: profile,
};
const task: PutawayTaskDto = {
  id: "task",
  code: "PUT-1",
  boxId: "box",
  skuId: "sku",
  status: "queued",
  employeeId: null,
  fromPalletId: "common",
  fromLocationId: "assembly",
  toLocationId: null,
  createdAt: box.packedAt,
  claimedAt: null,
  takenAt: null,
  completedAt: null,
};
function source(): Parameters<typeof isShipmentBoxAvailable>[0] {
  return {
    locations: [{ ...location }],
    pallets: [{ ...pallet }],
    sections: [],
    putawayTasks: [],
    shipments: [],
    movements: [],
  };
}

test("Резервировать отгрузку можно после размещения: накопление, перенос и незавершённый putaway исключены", () => {
  const data = source();
  assert.equal(isShipmentBoxAvailable(data, box), true);
  data.locations[0].kind = "assembly";
  assert.equal(isShipmentBoxAvailable(data, box), false); // legacy thematic pallet in assembly
  data.locations[0].kind = "floor";
  data.pallets[0].kind = "assembly";
  data.pallets[0].skuId = null;
  assert.equal(isShipmentBoxAvailable(data, box), false);
  data.pallets[0] = { ...pallet };
  data.putawayTasks = [{ ...task }];
  assert.equal(isShipmentBoxAvailable(data, box), false);
  data.putawayTasks[0].status = "in_transit";
  assert.equal(
    isShipmentBoxAvailable(data, {
      ...box,
      status: "in_transit",
      locationId: null,
      palletId: null,
    }),
    false,
  );
  data.putawayTasks[0].status = "completed";
  assert.equal(isShipmentBoxAvailable(data, box), true);
  data.shipments = [
    {
      id: "shipment",
      code: "SHIP-1",
      skuId: "sku",
      boxesRequested: 1,
      status: "draft",
      boxIds: ["box"],
    },
  ];
  assert.equal(isShipmentBoxAvailable(data, box), false);
  assert.equal(isShipmentBoxAvailable(data, box, "shipment"), true);
});

test("Паллета в запланированном или начатом перемещении недоступна для новой отгрузки до завершения", () => {
  const data = source();
  data.movements.push({
    id: "move",
    code: "MOVE-1",
    palletId: pallet.id,
    employeeId: "employee",
    fromLocationId: location.id,
    toLocationId: "picking",
    kind: "lower",
    status: "planned",
    keepSourceReserved: true,
    createdAt: box.packedAt,
    takenAt: null,
    completedAt: null,
  });
  assert.equal(isShipmentBoxAvailable(data, box), false);
  data.movements[0].status = "in_transit";
  assert.equal(isShipmentBoxAvailable(data, box), false);
  data.movements[0].status = "completed";
  assert.equal(isShipmentBoxAvailable(data, box), true);
  data.movements[0].status = "cancelled";
  assert.equal(isShipmentBoxAvailable(data, box), true);
  data.movements[0].status = "planned";
  data.movements[0].palletId = "other-pallet";
  assert.equal(isShipmentBoxAvailable(data, box), true);
});
