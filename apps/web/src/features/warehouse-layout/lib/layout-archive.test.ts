import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  LocationDto,
  PalletDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import { archiveReasons, layoutTrashItems } from "./layout-archive";

function workspace(): WorkspaceDto {
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
    revision: 0,
    warehouse: {
      name: "Склад",
      width: 24,
      depth: 16,
      workZones: [],
      zoneWork: [],
      layoutMode: "rectangle",
      spaces: [],
    },
    sections: [],
    aisles: [],
    entrances: [],
    movements: [],
    skus: [],
    locations: [],
    lots: [],
    pallets: [],
    boxes: [],
    tasks: [],
    employees: [],
    shipments: [],
    activities: [],
  };
}
function location(
  id: string,
  overrides: Partial<LocationDto> = {},
): LocationDto {
  return {
    id,
    code: id,
    name: id,
    kind: "rack",
    sectionId: "section",
    level: 1,
    levels: 1,
    x: 0,
    y: 0,
    width: 3,
    depth: 1.5,
    rotation: 0,
    archived: true,
    archivedAt: "2026-10-23T10:00:00Z",
    availableWidthMm: 1300,
    availableDepthMm: 900,
    maxWeightKg: null,
    accessSides: 1,
    maxHeightMm: 2000,
    maxBoxes: 18,
    blocked: false,
    ...overrides,
  };
}
function pallet(overrides: Partial<PalletDto> = {}): PalletDto {
  return {
    id: "pallet",
    code: "PLT-01",
    skuId: "sku",
    lotId: null,
    quantity: 0,
    locationId: "address",
    kind: "finished",
    widthMm: 1200,
    depthMm: 800,
    heightMm: 150,
    weightKg: null,
    packagingSnapshot: null,
    status: "stored",
    returnLocationId: null,
    ...overrides,
  };
}

test("пустой физический поддон запрещает удалить адрес до подтверждённого вывоза", () => {
  const data = workspace();
  data.pallets.push(pallet());
  assert.ok(
    archiveReasons(data, ["address"]).some((reason) =>
      reason.includes("Пустой поддон"),
    ),
  );
  data.pallets[0]!.status = "retired";
  assert.deepEqual(archiveReasons(data, ["address"]), []);
});

test("удаление проверяет и источник и цель активного перемещения, завершённая история не блокирует", () => {
  const data = workspace();
  data.movements.push({
    id: "movement",
    code: "MOVE-01",
    palletId: "pallet",
    employeeId: "employee",
    fromLocationId: "from",
    toLocationId: "to",
    kind: "transfer",
    status: "in_transit",
    keepSourceReserved: false,
    createdAt: "2026-10-23T10:00:00Z",
    takenAt: "2026-10-23T10:01:00Z",
    completedAt: null,
  });
  assert.equal(archiveReasons(data, ["from"]).length, 1);
  assert.equal(archiveReasons(data, ["to"]).length, 1);
  data.movements[0]!.status = "completed";
  assert.deepEqual(archiveReasons(data, ["from", "to"]), []);
});

test("удерживаемый адрес нельзя удалить даже во время переноса паллеты", () => {
  const data = workspace();
  data.pallets.push(
    pallet({
      status: "in_transit",
      locationId: null,
      returnLocationId: "address",
    }),
  );
  assert.ok(
    archiveReasons(data, ["address"]).some((reason) =>
      reason.includes("возврата"),
    ),
  );
});

test("корзина группирует удалённые с секцией ярусы и сохраняет отдельно удалённый ярус", () => {
  const data = workspace();
  data.sections.push({
    id: "section",
    code: "A",
    name: "Секция A",
    x: 0,
    y: 0,
    width: 3,
    depth: 1.5,
    rotation: 0,
    archived: true,
    archivedAt: "2026-10-23T12:00:00Z",
    archivedLocationIds: ["grouped"],
  });
  data.locations.push(location("grouped"), location("earlier", { level: 2 }));
  const items = layoutTrashItems(data);
  assert.deepEqual(items.map((item) => item.key).sort(), [
    "location:earlier",
    "section:section",
  ]);
  assert.match(
    items.find((item) => item.key === "location:earlier")!.restoreReason!,
    /Сначала восстановите секцию/,
  );
  data.sections[0]!.archived = false;
  data.locations[0]!.archived = false;
  assert.equal(
    layoutTrashItems(data).find((item) => item.key === "location:earlier")!
      .restoreReason,
    null,
  );
});

test("корзина восстанавливает участок отдельно, привязанный вход ждёт восстановления пола", () => {
  const data = workspace();
  data.warehouse.layoutMode = "spaces";
  data.warehouse.spaces.push({
    id: "room",
    name: "Помещение приёмки",
    kind: "room",
    x: 0,
    y: 0,
    width: 5,
    depth: 4,
    archived: true,
    archivedAt: "2026-10-23T13:00:00Z",
  });
  data.entrances.push({
    id: "entry",
    name: "Вход",
    spaceId: "room",
    wall: "north",
    offset: 0,
    width: 1.5,
    archived: true,
    archivedAt: "2026-10-23T12:00:00Z",
  });
  const items = layoutTrashItems(data);
  assert.ok(
    items.some(
      (item) => item.key === "space:room" && item.kind === "Помещение",
    ),
  );
  assert.match(
    items.find((item) => item.key === "entrance:entry")!.restoreReason!,
    /Сначала восстановите участок/,
  );
  data.warehouse.spaces[0]!.archived = false;
  assert.equal(
    layoutTrashItems(data).find((item) => item.key === "entrance:entry")!
      .restoreReason,
    null,
  );
});

test("Входящий короб запрещает удалить целевой адрес даже до появления физической паллеты", () => {
  const data = workspace();
  data.putawayTasks.push({
    id: "putaway",
    code: "PUT-1",
    boxId: "box",
    skuId: "sku",
    status: "in_transit",
    employeeId: "employee",
    fromPalletId: "common",
    fromLocationId: "assembly",
    toLocationId: "target",
    createdAt: "2026-10-23T00:00:00Z",
    claimedAt: "2026-10-23T00:00:00Z",
    takenAt: "2026-10-23T00:01:00Z",
    completedAt: null,
  });
  assert.match(archiveReasons(data, ["target"])[0], /размещения коробов/);
  assert.deepEqual(archiveReasons(data, ["assembly"]), []); // historical source does not hold an empty address after take
  data.putawayTasks[0].status = "completed";
  assert.deepEqual(archiveReasons(data, ["target"]), []);
});

test("active logical work-zone membership must be removed before archiving its address", () => {
  const data = workspace();
  data.warehouse.workZones = [
    {
      id: "zone",
      code: "WZ-01",
      name: "Приёмка 1",
      kind: "receiving",
      locationIds: ["address"],
      archived: false,
      archivedAt: null,
    },
  ];
  assert.match(archiveReasons(data, ["address"]).join(" "), /Приёмка 1/);
  data.warehouse.workZones[0].archived = true;
  assert.deepEqual(archiveReasons(data, ["address"]), []);
});
