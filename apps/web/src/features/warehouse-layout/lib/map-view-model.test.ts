import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LocationDtoKind,
  MovementDtoKind,
  MovementDtoStatus,
  PalletDtoKind,
  PalletDtoStatus,
} from "@/shared/api/generated/model";
import type {
  LocationDto,
  MovementDto,
  PalletDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import {
  addressAvailability,
  addressInventory,
  mapObjects,
  selectSavedCanvasObject,
} from "./map-view-model";
import {
  locationDefaults,
  locationSchema,
  toUpdateLocation,
} from "./location-form";

function location(overrides: Partial<LocationDto> = {}): LocationDto {
  return {
    id: "address-1",
    code: "A-01-01",
    name: "Первый ярус",
    kind: LocationDtoKind.rack,
    sectionId: "section-1",
    level: 1,
    levels: 1,
    x: 2,
    y: 2,
    width: 3,
    depth: 2,
    availableWidthMm: 1300,
    availableDepthMm: 900,
    maxHeightMm: 1800,
    maxBoxes: 18,
    maxWeightKg: null,
    accessSides: 1,
    blocked: false,
    rotation: 0,
    archived: false,
    archivedAt: null,
    ...overrides,
  };
}
function pallet(overrides: Partial<PalletDto> = {}): PalletDto {
  return {
    id: "pallet-1",
    code: "P-001",
    skuId: "sku-1",
    lotId: "lot-1",
    quantity: 0,
    kind: PalletDtoKind.raw,
    status: PalletDtoStatus.stored,
    locationId: "address-1",
    returnLocationId: null,
    widthMm: 1200,
    depthMm: 800,
    heightMm: 150,
    weightKg: 20,
    packagingSnapshot: null,
    ...overrides,
  };
}
function movement(overrides: Partial<MovementDto> = {}): MovementDto {
  return {
    id: "movement-1",
    code: "M-001",
    palletId: "pallet-1",
    fromLocationId: "another",
    toLocationId: "address-1",
    kind: MovementDtoKind.transfer,
    status: MovementDtoStatus.planned,
    employeeId: "employee-1",
    keepSourceReserved: false,
    createdAt: "2026-10-23T10:00:00.000Z",
    takenAt: null,
    completedAt: null,
    ...overrides,
  };
}
function workspace(overrides: Partial<WorkspaceDto> = {}): WorkspaceDto {
  return {
    receipts: [],
    putawayTasks: [],
    balance: {
      rawUnits: 0,
      workInProgressUnits: 0,
      boxedUnits: 0,
      totalUnits: 0,
      awaitingPlacementUnits: 0,
      awaitingPlacementPallets: 0,
    },
    revision: 1,
    warehouse: {
      name: "Проверочный склад",
      width: 24,
      depth: 16,
      workZones: [],
      zoneWork: [],
      layoutMode: "rectangle",
      spaces: [],
    },
    aisles: [],
    entrances: [],
    sections: [],
    locations: [location()],
    pallets: [],
    boxes: [],
    movements: [],
    skus: [],
    lots: [],
    tasks: [],
    employees: [],
    shipments: [],
    activities: [],
    ...overrides,
  };
}

test("Повторное создание выбирает новый ID вместо архивного объекта с теми же полями независимо от порядка", () => {
  const archived = {
    id: "archived",
    archived: true,
    name: "Проход",
    x: 2,
    y: 3,
  };
  const existing = { ...archived, id: "existing-active", archived: false };
  const created = { ...existing, id: "created" };
  const beforeIds = new Set([archived.id, existing.id]);
  const matches = (item: typeof archived) =>
    item.name === "Проход" && item.x === 2 && item.y === 3;
  for (const items of [
    [archived, existing, created],
    [created, existing, archived],
  ]) {
    assert.equal(
      selectSavedCanvasObject(items, beforeIds, matches)?.id,
      created.id,
    );
  }
  // A poll may already have delivered the new identity before an idempotent retry returns.
  assert.equal(
    selectSavedCanvasObject(
      [archived, created],
      new Set([archived.id, created.id]),
      matches,
    )?.id,
    created.id,
  );
  assert.equal(
    selectSavedCanvasObject([archived], beforeIds, matches),
    undefined,
  );
  // Updates select their exact identity and do not fall back to another matching object.
  assert.equal(
    selectSavedCanvasObject(
      [created, existing],
      beforeIds,
      matches,
      existing.id,
    )?.id,
    existing.id,
  );
  assert.equal(
    selectSavedCanvasObject([created], beforeIds, matches, "missing-id"),
    undefined,
  );
});

test("Two real rack addresses produce one section drawing and preserve both address IDs", () => {
  const data = workspace({
    sections: [
      {
        id: "section-1",
        code: "A-01",
        name: "Секция A",
        x: 2,
        y: 2,
        width: 3,
        depth: 2,
        rotation: 0,
        archived: false,
        archivedAt: null,
        archivedLocationIds: [],
      },
    ],
    locations: [
      location(),
      location({ id: "address-2", code: "A-01-02", level: 2 }),
    ],
  });
  const objects = mapObjects(data);
  assert.equal(objects.length, 1);
  assert.deepEqual(
    objects[0].addresses.map((item) => item.id),
    ["address-1", "address-2"],
  );
});

test("Архивные ярусы и напольные места не появляются в оперативной проекции", () => {
  const data = workspace({
    sections: [
      {
        id: "section-1",
        code: "A-01",
        name: "Секция",
        x: 2,
        y: 2,
        width: 3,
        depth: 2,
        rotation: 90,
        archived: false,
        archivedAt: null,
        archivedLocationIds: [],
      },
    ],
    locations: [
      location(),
      location({ id: "hidden-level", level: 2, archived: true }),
      location({ id: "hidden-floor", sectionId: null, archived: true }),
    ],
  });
  const objects = mapObjects(data);
  assert.equal(objects.length, 1);
  assert.equal(objects[0].rotation, 90);
  assert.deepEqual(
    objects[0].addresses.map((address) => address.id),
    ["address-1"],
  );
  data.sections[0].archived = true;
  assert.deepEqual(mapObjects(data), []);
  assert.equal(
    addressAvailability(data, location({ archived: true })),
    "В корзине",
  );
});

test("Zero inventory does not release a physically stored pallet", () => {
  const data = workspace({ pallets: [pallet()] });
  assert.equal(addressInventory(data, ["address-1"]).occupied, true);
  assert.equal(addressAvailability(data, location()), "Паллета на месте");
  assert.equal(
    addressInventory(
      workspace({
        pallets: [
          pallet({ status: PalletDtoStatus.retired, locationId: null }),
        ],
      }),
      ["address-1"],
    ).occupied,
    false,
  );
});

test("An in-transit pallet leaves physical occupancy but keeps its return address reserved", () => {
  const data = workspace({
    pallets: [
      pallet({
        status: PalletDtoStatus.in_transit,
        locationId: null,
        returnLocationId: "address-1",
      }),
    ],
  });
  const inventory = addressInventory(data, ["address-1"]);
  assert.equal(inventory.occupied, false);
  assert.equal(inventory.reserved, true);
  assert.equal(addressAvailability(data, location()), "Резерв возврата");
});

test("Movement targets are reserved only while planned or in transit", () => {
  const active = workspace({ movements: [movement()] });
  assert.equal(addressAvailability(active, location()), "Ожидает паллету");
  const completed = workspace({
    movements: [movement({ status: MovementDtoStatus.completed })],
  });
  assert.equal(addressAvailability(completed, location()), "Свободно");
});

test("Rack limit editing never moves a child independently; picking requires four access sides", () => {
  const values = locationDefaults(location());
  const update = toUpdateLocation({ ...values, x: 18, width: 7 }, true);
  assert.equal("x" in update, false);
  assert.equal("width" in update, false);
  assert.equal(update.availableWidthMm, 1300);
  assert.equal(
    locationSchema.safeParse({
      ...values,
      kind: LocationDtoKind.picking,
      accessSides: 1,
    }).success,
    false,
  );
  assert.equal(
    locationSchema.safeParse({
      ...values,
      kind: LocationDtoKind.picking,
      accessSides: 4,
    }).success,
    true,
  );
});

test("Резерв размещения короба защищает пустую цель и остаётся видимым у занятой цели до завершения", () => {
  const data = workspace();
  data.putawayTasks.push({
    id: "putaway",
    code: "PUT-1",
    boxId: "box",
    skuId: "sku",
    status: "claimed",
    employeeId: "employee",
    fromPalletId: "common",
    fromLocationId: "assembly",
    toLocationId: "address-1",
    createdAt: "2026-10-23T00:00:00Z",
    claimedAt: "2026-10-23T00:00:00Z",
    takenAt: null,
    completedAt: null,
  });
  assert.equal(addressInventory(data, ["address-1"]).reserved, true);
  assert.equal(addressAvailability(data, location()), "Резерв: 1 кор.");
  data.pallets.push(pallet({ kind: "assembly", skuId: null }));
  assert.equal(addressInventory(data, ["address-1"]).occupied, true);
  assert.equal(
    addressInventory(data, ["address-1"]).incomingPutaways.length,
    1,
  );
  data.putawayTasks[0].status = "completed";
  assert.equal(addressInventory(data, ["address-1"]).reserved, false);
  assert.equal(addressInventory(data, ["address-1"]).occupied, true);
});

test("Обезличенные резервы остаются видимыми без чужих заданий, свои и повторные holds не дублируются", () => {
  for (const kind of ["movement", "putaway", "return"] as const) {
    const data = workspace({
      addressHolds: [
        { locationId: "address-1", kind },
        { locationId: "address-1", kind },
      ],
      movements: [],
      putawayTasks: [],
      pallets: [],
    });
    const state = addressInventory(data, ["address-1"]);
    assert.equal(state.reserved, true);
    assert.equal(state.additionalHolds.length, 1);
    assert.notEqual(addressAvailability(data, location()), "Свободно");
    assert.equal(state.incoming.length, 0);
    assert.equal(addressInventory(data, ["unrelated"]).reserved, false);
  }
  const own = workspace({
    addressHolds: [{ locationId: "address-1", kind: "movement" }],
    movements: [movement()],
  });
  assert.equal(addressInventory(own, ["address-1"]).additionalHolds.length, 0);
  assert.equal(addressInventory(own, ["address-1"]).incoming.length, 1);
  const legacy = workspace({ movements: [], pallets: [] });
  assert.equal(addressInventory(legacy, ["address-1"]).reserved, false);
  assert.equal(addressAvailability(legacy, location()), "Свободно");
});
