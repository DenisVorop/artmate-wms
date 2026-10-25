import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  WorkspaceDto,
  TaskDto,
  PalletDto,
  LocationDto,
  StocktakeSummaryDto,
} from "@/shared/api/generated/model";
import { buildWorkQueue, filterWorkQueue } from "./work-queue";
const workspace = (patch: Partial<WorkspaceDto> = {}): WorkspaceDto => ({
  revision: 1,
  warehouse: {
    name: "Склад",
    width: 20,
    depth: 20,
    layoutMode: "spaces",
    spaces: [],
    workZones: [],
    zoneWork: [],
  },
  addressHolds: [],
  aisles: [],
  entrances: [],
  sections: [],
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
  putawayTasks: [],
  receipts: [],
  balance: {
    rawUnits: 0,
    workInProgressUnits: 0,
    boxedUnits: 0,
    totalUnits: 0,
    awaitingPlacementUnits: 0,
    awaitingPlacementPallets: 0,
  },
  ...patch,
});
const task = (patch: Partial<TaskDto> = {}): TaskDto => ({
  id: "assembly",
  code: "JOB-1",
  createdAt: "2026-01-01T10:00:00Z",
  status: "queued",
  skuId: "sku",
  boxesTarget: 2,
  boxesCompleted: 0,
  unitsPerBox: 20,
  employeeId: null,
  scannedUnits: 0,
  sourcePalletId: null,
  boxCodeConfirmed: false,
  openBoxCode: "BOX-1",
  openBoxContents: [],
  reservations: [],
  ...patch,
});
const pallet = (id: string, locationId: string): PalletDto => ({
  id,
  code: id,
  skuId: "sku",
  lotId: null,
  kind: "raw",
  quantity: 40,
  locationId,
  widthMm: 1200,
  depthMm: 800,
  heightMm: 1000,
  weightKg: null,
  status: "stored",
  returnLocationId: null,
  packagingSnapshot: null,
});
const location = (id: string): LocationDto => ({
  id,
  code: id,
  name: `Место ${id}`,
  kind: "floor",
  x: 0,
  y: 0,
  width: 2,
  depth: 2,
  levels: 1,
  level: 1,
  sectionId: null,
  rotation: 0,
  maxHeightMm: 2000,
  maxBoxes: 18,
  availableWidthMm: 1200,
  availableDepthMm: 800,
  maxWeightKg: null,
  accessSides: 4,
  blocked: false,
  archived: false,
  archivedAt: null,
});
const stocktake = (
  patch: Partial<StocktakeSummaryDto> = {},
): StocktakeSummaryDto => ({
  id: "count",
  code: "COUNT-1",
  status: "review",
  revision: 3,
  createdAt: "2026-01-01T10:00:00Z",
  createdByEmployeeId: "manager",
  createdByName: "Руководитель",
  employeeId: "worker",
  employeeName: "Денис",
  approvedAt: null,
  cancelledAt: null,
  reason: null,
  locationsTotal: 2,
  locationsCounted: 2,
  staleLocations: 0,
  ...patch,
});

test("Одна очередь включает все виды работ и скрывает завершённые по умолчанию", () => {
  const data = workspace({
    tasks: [
      task(),
      task({ id: "done", status: "completed", boxesCompleted: 2 }),
    ],
    receipts: [
      {
        id: "receipt",
        code: "REC-1",
        createdAt: "2026-01-02",
        receivedAt: "2026-01-02",
        completedAt: null,
        status: "awaiting_placement",
        pallets: [
          {
            palletId: "inbound",
            skuId: "sku",
            quantity: 40,
            placedAt: null,
            placedByEmployeeId: null,
            locationId: null,
          },
        ],
      },
    ],
    putawayTasks: [
      {
        id: "put",
        code: "PUT-1",
        skuId: "sku",
        boxId: "box",
        status: "in_transit",
        employeeId: "worker",
        fromPalletId: "assembly-pallet",
        fromLocationId: "assembly",
        toLocationId: "A-1",
        createdAt: "2026-01-02",
        claimedAt: null,
        takenAt: "2026-01-03",
        completedAt: null,
      },
    ],
    movements: [
      {
        id: "move",
        code: "MOVE-1",
        palletId: "raw",
        fromLocationId: "A-1",
        toLocationId: "A-2",
        kind: "transfer",
        status: "planned",
        employeeId: "worker",
        keepSourceReserved: false,
        createdAt: "2026-01-02",
        takenAt: null,
        completedAt: null,
      },
    ],
    shipments: [
      {
        id: "ship",
        code: "SHIP-1",
        skuId: "sku",
        boxesRequested: 3,
        status: "draft",
        boxIds: ["b1", "b2", "b3"],
        scannedBoxIds: ["b1"],
        employeeId: "worker",
      },
    ],
  });
  const before = structuredClone(data);
  const jobs = buildWorkQueue(data, [stocktake()]);
  assert.deepEqual(
    new Set(jobs.map((job) => job.kind)),
    new Set([
      "assembly",
      "receiving",
      "putaway",
      "movement",
      "shipping",
      "stocktake",
    ]),
  );
  assert.equal(filterWorkQueue(jobs).length, 6);
  assert.equal(
    filterWorkQueue(jobs, { state: "archive" })[0]?.referenceId,
    "done",
  );
  assert.equal(
    jobs.find((job) => job.kind === "shipping")?.quantityLabel,
    "1 / 3 коробов",
  );
  assert.equal(
    jobs.find((job) => job.kind === "putaway")?.statusLabel,
    "Короб в руках",
  );
  assert.equal(jobs.find((job) => job.kind === "stocktake")?.state, "review");
  assert.deepEqual(
    data,
    before,
    "Построение очереди не мутирует состояние и резервы",
  );
});
test("Паллеты одной частичной приёмки имеют разные ключи, состояния и исполнителей", () => {
  const data = workspace({
    receipts: [
      {
        id: "receipt",
        code: "REC-1",
        createdAt: "2026-01-01",
        receivedAt: "2026-01-01",
        completedAt: null,
        status: "partially_placed",
        pallets: [
          {
            palletId: "first",
            skuId: "sku",
            quantity: 30,
            locationId: "A-1",
            placedAt: "2026-01-02",
            placedByEmployeeId: "worker",
          },
          {
            palletId: "second",
            skuId: "sku",
            quantity: 50,
            locationId: null,
            placedAt: null,
            placedByEmployeeId: null,
          },
        ],
      },
    ],
  });
  data.warehouse.zoneWork = [
    {
      employeeId: "other",
      zoneId: "receiving",
      jobKind: "receiving",
      jobId: "receipt",
      palletId: "second",
      message: "",
    },
  ];
  const jobs = buildWorkQueue(data);
  assert.equal(new Set(jobs.map((job) => job.id)).size, 2);
  assert.equal(
    jobs.find((job) => job.palletId === "first")?.state,
    "completed",
  );
  assert.equal(
    jobs.find((job) => job.palletId === "second")?.employeeId,
    "other",
  );
  assert.equal(jobs.find((job) => job.palletId === "second")?.state, "active");
  assert.equal(filterWorkQueue(jobs, { employeeId: "other" }).length, 1);
});
test("Проекция сотрудника не превращает неизвестное назначение приёмки в свободное задание", () => {
  const data = workspace({
    receipts: [
      {
        id: "receipt",
        code: "REC-1",
        createdAt: "2026-01-01",
        receivedAt: "2026-01-01",
        completedAt: null,
        status: "awaiting_placement",
        pallets: [
          {
            palletId: "p",
            skuId: "sku",
            quantity: 20,
            locationId: null,
            placedAt: null,
            placedByEmployeeId: null,
          },
        ],
      },
    ],
  });
  const job = buildWorkQueue(data)[0]!;
  assert.equal(job.assignmentKnown, false);
  assert.equal(job.statusLabel, "Ожидает размещения");
  assert.equal(filterWorkQueue([job], { employeeId: "free" }).length, 0);
  assert.equal(
    filterWorkQueue(buildWorkQueue(data, [], { manager: true }), {
      employeeId: "free",
    }).length,
    1,
  );
  assert.equal(job.employeeName, null);
});
test("Источник сборки берётся из непустого резерва, а неизвестные даты и имена не придумываются", () => {
  const data = workspace({
    tasks: [
      task({
        createdAt: null,
        employeeId: "unavailable",
        sourcePalletId: "old",
        reservations: [
          { lotId: "old", palletId: "old", quantity: 0 },
          { lotId: "new", palletId: "new", quantity: 40 },
        ],
      }),
    ],
    pallets: [pallet("old", "A-1"), pallet("new", "A-2")],
    locations: [location("A-1"), location("A-2")],
  });
  const job = buildWorkQueue(data)[0]!;
  assert.equal(job.fromLabel, "A-2 · Место A-2");
  assert.equal(job.createdAt, null);
  assert.equal(job.updatedAt, null);
  assert.equal(job.employeeName, "Исполнитель недоступен");
  assert.equal(filterWorkQueue([job], { search: "a-2" }).length, 1);
  assert.equal(filterWorkQueue([job], { employeeId: "free" }).length, 0);
  assert.equal(buildWorkQueue(workspace()).length, 0);
});
test("Архив инвентаризаций и отменённых перемещений отделён от проверки и текущей очереди", () => {
  const jobs = buildWorkQueue(
    workspace({
      movements: [
        {
          id: "move",
          code: "MOVE",
          palletId: "p",
          fromLocationId: "A",
          toLocationId: "B",
          employeeId: "worker",
          kind: "transfer",
          keepSourceReserved: false,
          status: "cancelled",
          createdAt: "2026-01-01",
          takenAt: null,
          completedAt: null,
        },
      ],
    }),
    [
      stocktake(),
      stocktake({
        id: "approved",
        status: "approved",
        approvedAt: "2026-01-02",
      }),
    ],
  );
  assert.equal(filterWorkQueue(jobs).length, 1);
  assert.equal(filterWorkQueue(jobs, { state: "archive" }).length, 2);
  assert.equal(
    filterWorkQueue(jobs, { state: "review", kind: "stocktake" })[0]?.href,
    "/stocktakes?stocktakeId=count",
  );
});
