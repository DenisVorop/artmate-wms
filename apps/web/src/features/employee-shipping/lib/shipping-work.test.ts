import assert from "node:assert/strict";
import test from "node:test";
import type {
  ShipmentDto,
  WorkspaceDto,
  WorkZoneDto,
  LocationDto,
  PalletDto,
  BoxDto,
  PackagingProfileDto,
} from "@/shared/api/generated/model";
import {
  employeeShippingWork,
  employeeShippingProgress,
  employeeShippingScopeIssue,
  employeeWbPickHistory,
} from "./shipping-work";
const shipment = (patch: Partial<ShipmentDto> = {}): ShipmentDto => ({
  id: "shipment",
  code: "SHIP-1",
  skuId: "sku",
  boxesRequested: 2,
  status: "draft",
  boxIds: ["box-1", "box-2"],
  employeeId: "self",
  workZoneId: "zone",
  scannedBoxIds: [],
  ...patch,
});
const zone: WorkZoneDto = {
  id: "zone",
  code: "Z-1",
  name: "Отгрузка",
  kind: "shipping",
  locationIds: ["location"],
  archived: false,
  archivedAt: null,
};
const warehouse: WorkspaceDto["warehouse"] = {
  name: "Склад",
  width: 30,
  depth: 20,
  layoutMode: "rectangle",
  spaces: [],
  workZones: [zone],
  zoneWork: [
    {
      employeeId: "self",
      zoneId: "zone",
      jobKind: "shipping",
      jobId: "shipment",
      palletId: null,
      message: "Короба готовы",
    },
  ],
};
test("shipping only opens the exact own server assignment, never an arbitrary draft or another employee's job", () => {
  const own = shipment();
  const newer = shipment({ id: "unassigned", employeeId: null });
  assert.equal(
    employeeShippingWork({ warehouse, shipments: [newer, own] }, "self")
      .shipment,
    own,
  );
  assert.equal(
    employeeShippingWork(
      { warehouse, shipments: [{ ...own, employeeId: "other" }] },
      "self",
    ).shipment,
    undefined,
  );
  assert.equal(
    employeeShippingWork(
      { warehouse, shipments: [{ ...own, workZoneId: "another" }] },
      "self",
    ).shipment,
    undefined,
  );
  assert.equal(
    employeeShippingWork(
      { warehouse: { ...warehouse, zoneWork: [] }, shipments: [own] },
      "self",
    ).shipment,
    undefined,
  );
});
test("progress counts only unique actual reserved box scans and retains the first unscanned object", () => {
  const state = employeeShippingProgress(
    shipment({ scannedBoxIds: ["box-2", "box-2", "foreign"] }),
  );
  assert.equal(state.scanned, 1);
  assert.equal(state.nextBoxId, "box-1");
  assert.equal(state.complete, false);
  assert.equal(
    employeeShippingProgress(shipment({ scannedBoxIds: ["box-1", "box-2"] }))
      .complete,
    true,
  );
  assert.equal(
    employeeShippingProgress(
      shipment({ boxesRequested: 3, scannedBoxIds: ["box-1", "box-2"] }),
    ).complete,
    false,
  );
  assert.equal(
    employeeShippingProgress(shipment({ boxIds: [], boxesRequested: 0 }))
      .complete,
    false,
  );
  assert.equal(
    employeeShippingProgress(
      shipment({ boxIds: ["box-1", "box-1"], scannedBoxIds: ["box-1"] }),
    ).complete,
    false,
  );
});
test("WB pick history shows printed numbers of saved scans in reverse scan order", () => {
  const row = shipment({
    boxIds: ["box-1", "box-2", "box-3"],
    scannedBoxIds: ["box-2", "box-1"],
    wb: {
      supplyId: "42043227",
      storeId: "wb",
      sourceShipmentIds: [],
      locationId: "location",
      pendingBoxId: "box-3",
      labels: [
        {
          id: "18264647",
          code: "$Ts;first",
          boxId: "box-1",
          skuId: "cats",
          units: 20,
        },
        {
          id: "18264664",
          code: "$Ts;second",
          boxId: "box-2",
          skuId: "dogs",
          units: 20,
        },
        { id: "18264681", code: "$Ts;pending", skuId: "food", units: 20 },
      ],
    },
  });
  assert.deepEqual(employeeWbPickHistory(row), [
    { boxId: "box-1", skuId: "cats", number: "1826 4647" },
    { boxId: "box-2", skuId: "dogs", number: "1826 4664" },
  ]);
});

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
  code: "OUT-01",
  name: "Отгрузка",
  kind: "shipping",
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
  accessSides: 4,
  blocked: false,
};
const pallet: PalletDto = {
  id: "pallet",
  code: "FG-1",
  skuId: "sku",
  kind: "finished",
  quantity: 2,
  lotId: null,
  locationId: "location",
  status: "stored",
  returnLocationId: null,
  packagingSnapshot: profile,
  widthMm: 1200,
  depthMm: 800,
  heightMm: 450,
  weightKg: null,
};
const box = (id: string): BoxDto => ({
  id,
  code: id,
  skuId: "sku",
  units: 20,
  lotContents: [{ lotId: "lot", quantity: 20 }],
  packedAt: "2026-10-24T00:00:00Z",
  locationId: "location",
  palletId: "pallet",
  status: "stored",
  packagingSnapshot: profile,
});
test("all-confirmed scans do not hide a newly blocked or moved shipment scope", () => {
  const data: Parameters<typeof employeeShippingScopeIssue>[0] = {
    boxes: [box("box-1"), box("box-2")],
    pallets: [pallet],
    locations: [location],
    movements: [],
  };
  assert.equal(employeeShippingScopeIssue(data, shipment(), zone), null);
  assert.notEqual(
    employeeShippingScopeIssue(
      { ...data, locations: [{ ...location, blocked: true }] },
      shipment(),
      zone,
    ),
    null,
  );
  assert.notEqual(
    employeeShippingScopeIssue(
      { ...data, boxes: [box("box-1")] },
      shipment(),
      zone,
    ),
    null,
  );
  assert.notEqual(
    employeeShippingScopeIssue(data, shipment(), {
      ...zone,
      locationIds: ["other"],
    }),
    null,
  );
  assert.notEqual(
    employeeShippingScopeIssue(
      { ...data, pallets: [{ ...pallet, status: "in_transit" }] },
      shipment(),
      zone,
    ),
    null,
  );
});
