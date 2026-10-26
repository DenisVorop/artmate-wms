import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedWorkspace } from "../src/seed";
import { migrateAddressesAndMovements } from "../src/migrations";
import { marketplacePlan } from "../src/marketplaces/planning";
import { dispatchSchedule } from "../src/marketplaces/unified-plan";
import {
  defaultSettings,
  type MarketplaceState,
  type Connection,
} from "../src/marketplaces/storage";
import type { ForecastPlanContext } from "../src/forecasting/forecast-storage";
import type { MarketplaceProvider } from "../src/marketplaces/providers/types";
import type { BoxDto, TaskDto, ShipmentDto, WorkspaceDto } from "../src/dto";
const now = new Date("2026-10-31T10:00:00Z");
function fixture() {
  const w: WorkspaceDto = migrateAddressesAndMovements(seedWorkspace());
  w.skus = w.skus.filter((sku) => sku.id === "sku-cats");
  w.boxes = [];
  w.tasks = [];
  w.shipments = [];
  const providers: MarketplaceProvider[] = ["wildberries", "ozon"];
  const m: MarketplaceState = {
    connections: providers.map(
      (provider): Connection => ({
        provider,
        encrypted: "secret-fixture",
        clientId: null,
        enabled: true,
        version: 1,
        syncStatus: "success",
        lastSuccessAt: now.toISOString(),
        lastAttemptAt: null,
        message: null,
        warnings: [],
        runId: null,
      }),
    ),
    snapshots: providers.map((provider) => ({
      provider,
      asOf: now.toISOString(),
      from: "2026-08-01",
      to: "2026-10-30",
      products: [{ externalId: "one", name: "Cats", barcodes: [] }],
      demand: [],
      warnings: [],
      stocks: [
        {
          externalId: "one",
          warehouseId: "warehouse",
          warehouseName: "warehouse",
          availableUnits: 0,
          inboundUnits: 0,
          reservedUnits: 0,
        },
      ],
      inbound: [
        {
          externalId: "one",
          units: 0,
          source: provider === "ozon" ? "ozon_analytics" : "wb_supplies",
          supplyIds: [],
          warnings: [],
        },
      ],
      coverage: { catalog: true, stocks: true, demand: true, inbound: true },
    })),
    mappings: providers.map((provider) => ({
      provider,
      externalId: "one",
      skuId: "sku-cats",
      unitsPerItem: 1,
    })),
    settings: {
      ...defaultSettings,
      horizonDays: 7,
      safetyDays: 0,
      leadDays: 0,
    },
    transit: {},
  };
  const context: ForecastPlanContext = {
    key: "fixed",
    minimumBoxes: {},
    goals: {
      "sku-cats": {
        targetUnits: 140,
        methodLabel: "Test",
        confidenceLabel: "Test",
        message: "Verified test",
        seasonalityApplied: false,
        sources: providers.map((provider) => ({
          provider,
          methodLabel: "Machine learning",
          confidenceLabel: "Validated",
          scenario: false,
          dailyForecast: Array.from({ length: 100 }, (_, i) => ({
            date: new Date(Date.parse("2026-10-31") + i * 86400000)
              .toISOString()
              .slice(0, 10),
            units: 10,
          })),
        })),
      },
    },
  };
  return { w, m, context };
}
const physicalBox = (id: string): BoxDto =>
  ({
    id,
    skuId: "sku-cats",
    units: 20,
    status: "stored",
    locationId: "unknown",
    palletId: "assembly",
  }) as BoxDto;
test("provider needs remain independent even when another provider has excess stock", () => {
  const { w, m, context } = fixture();
  m.snapshots[0].stocks[0].availableUnits = 1000;
  const row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.providers[0].dispatchBoxes, 0);
  assert.equal(row.providers[1].dispatchBoxes, 4); // 70 demand -> four complete boxes
  assert.equal(row.outboundUnits, 80);
  assert.equal(row.recommendedBoxes, 4);
});
test("draft reserves and WIP each fulfill exactly one part of dispatch and reserve", () => {
  const { w, m, context } = fixture();
  for (let i = 0; i < 5; i++) w.boxes.push(physicalBox(`box-${i}`));
  w.shipments.push({
    id: "draft",
    skuId: "sku-cats",
    status: "draft",
    boxIds: ["box-0", "box-1"],
  } as ShipmentDto);
  w.tasks.push({
    id: "work",
    skuId: "sku-cats",
    status: "active",
    boxesTarget: 2,
    boxesCompleted: 1,
    unitsPerBox: 20,
    scannedUnits: 15,
    reservations: [],
    openBoxContents: [],
  } as unknown as TaskDto);
  const row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.readyUnits, 60);
  assert.equal(row.shipmentReservedUnits, 40);
  assert.equal(row.openTaskUnits, 20);
  assert.equal(row.outboundUnits, 160);
  assert.equal(row.newOutboundUnits, 120);
  assert.equal(row.dispatchShortageUnits, 60);
  assert.equal(row.localAfterDispatchUnits, 0);
  assert.equal(row.assemblyShortageUnits, 40);
  assert.equal(row.recommendedBoxes, 2);
  assert.equal(row.localAfterAssemblyUnits, 0);
  assert.equal(row.dataComplete, false);
  assert.equal(row.canCreate, false);
  assert.match(row.advice.message, /зарезервированные/);
});
test("already sent inbound reduces only its own provider demand and never warehouse stock", () => {
  const { w, m, context } = fixture();
  m.snapshots[0].inbound![0].units = 100;
  for (let i = 0; i < 10; i++) w.boxes.push(physicalBox(`box-${i}`));
  const row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.outboundUnits, 80);
  assert.equal(row.readyUnits, 200);
  assert.equal(row.localAfterDispatchUnits, 120);
  assert.equal(row.recommendedBoxes, 0);
});
test("unregistered confirmed stock contributes to assembly arithmetic but grants no physical dispatch", () => {
  const { w, m, context } = fixture();
  m.planningStock = [
    {
      skuId: "sku-cats",
      units: 200,
      accuracy: "exact",
      countedAt: now.toISOString(),
      trackedUnitsAtCount: 0,
      unitsPerBoxAtCount: 20,
      outboundSupplyKeys: [],
      enabled: true,
    } as never,
  ];
  const row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.readyUnits, 200);
  assert.equal(row.localAfterDispatchUnits, 40);
  assert.equal(row.shippingReadyUnits, 0);
  assert.equal(row.recommendedBoxes, 0);
  m.planningStock![0].accuracy = "approximate";
  assert.equal(marketplacePlan(w, m, now, context).rows[0].dataComplete, false);
});
test("unknown quantities block full recommendations; aggregate positive manual transit cannot be allocated", () => {
  const { w, m, context } = fixture();
  m.snapshots[0].inbound![0].units = null;
  let row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.dataComplete, false);
  assert.equal(row.canCreate, false);
  assert.equal(row.providers[0].dataComplete, false);
  assert.equal(row.providers[1].dataComplete, true);
  m.transit["sku-cats"] = 25;
  row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.dataComplete, false);
  assert.equal(row.providers[0].inTransitUnits, null);
  assert.match(row.advice.message, /отдельно/);
  m.transit["sku-cats"] = 0;
  assert.equal(marketplacePlan(w, m, now, context).rows[0].dataComplete, true);
});
test("dispatch schedule uses Moscow calendar and target includes waiting plus arrival time", () => {
  assert.deepEqual(dispatchSchedule(new Date("2026-10-30T21:05:00Z"), 6), {
    today: "2026-10-31",
    waitDays: 0,
    dispatchDate: "2026-10-31",
  });
  const { w, m, context } = fixture();
  const monday = new Date("2026-10-26T10:00:00Z");
  // Sources start on today; use five extra days of forecast before Saturday.
  context.goals["sku-cats"].sources!.forEach((s) =>
    s.dailyForecast.forEach((p) => {
      p.date = new Date(Date.parse(p.date) - 5 * 86400000)
        .toISOString()
        .slice(0, 10);
    }),
  );
  m.snapshots.forEach((s) => {
    s.asOf = monday.toISOString();
    s.to = "2026-10-25";
  });
  m.settings.leadDays = 3;
  const plan = marketplacePlan(w, m, monday, context);
  assert.equal(plan.dispatchDate, "2026-10-31");
  assert.equal(plan.rows[0].providers[0].targetUnits, 150); // 5 waiting + 3 delivery + 7 coverage
});

test("optional queue offers one physical box, stops for full capacity and accounts for already open work", () => {
  const { w, m, context } = fixture();
  m.snapshots.forEach((snapshot) => {
    snapshot.stocks[0].availableUnits = 1000;
  });
  w.putawayTasks = [];
  const raw = w.pallets.find(
    (pallet) => pallet.skuId === "sku-cats" && pallet.kind === "raw",
  )!;
  raw.status = "stored";
  raw.quantity = 200;
  w.pallets = [raw];
  let row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.recommendedBoxes, 0);
  assert.equal(row.backlogRank, 1);
  assert.equal(row.backlogBoxes, 1);
  assert.equal(row.backlogCanCreate, true);
  assert.equal(row.backlogCapacityKnown, true);
  const readyHash = row.proposalHash;
  w.locations.forEach((location) => {
    if (location.id !== raw.locationId) location.blocked = true;
  });
  row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.backlogRank, 1);
  assert.equal(row.backlogBoxes, 0);
  assert.equal(row.backlogCanCreate, false);
  assert.match(row.backlogReason, /Свободных мест/);
  assert.notEqual(row.proposalHash, readyHash);
});
test("unregistered stock leaves optional priority visible without pretending to know free capacity", () => {
  const { w, m, context } = fixture();
  m.planningStock = [
    {
      skuId: "sku-cats",
      units: 200,
      accuracy: "exact",
      countedAt: now.toISOString(),
      trackedUnitsAtCount: 0,
      unitsPerBoxAtCount: 20,
      outboundSupplyKeys: [],
      enabled: true,
    } as never,
  ];
  const row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.backlogRank, 1);
  assert.equal(row.backlogCapacityKnown, false);
  assert.equal(row.backlogBoxes, 0);
  assert.equal(row.backlogCanCreate, false);
});

test("disabled planning SKU still consumes physical capacity and unregistered occupancy", () => {
  const { w, m, context } = fixture();
  m.snapshots.forEach((snapshot) => {
    snapshot.stocks[0].availableUnits = 1000;
  });
  const raw = w.pallets.find(
    (p) => p.skuId === "sku-cats" && p.kind === "raw",
  )!;
  raw.status = "stored";
  raw.quantity = 200;
  w.pallets = [raw];
  w.putawayTasks = [];
  const disabled = { ...w.skus[0], id: "disabled", name: "Old theme" };
  w.skus.push(disabled);
  m.planningStock = [
    {
      skuId: "disabled",
      units: 20,
      accuracy: "exact",
      trackedUnitsAtCount: 0,
      enabled: false,
    } as never,
  ];
  let row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.backlogCapacityKnown, false);
  assert.equal(row.backlogCanCreate, false);
  m.planningStock![0].units = 0;
  const free = w.locations.find(
    (l) => l.kind === "rack" && l.id !== raw.locationId,
  )!;
  w.locations.forEach((l) => {
    l.blocked = l.id !== raw.locationId && l.id !== free.id;
  });
  free.maxBoxes = 1;
  w.tasks.push({
    id: "old-work",
    skuId: "disabled",
    status: "queued",
    boxesTarget: 1,
    boxesCompleted: 0,
    unitsPerBox: 20,
    reservations: [],
  } as unknown as TaskDto);
  row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.backlogCapacityKnown, true);
  assert.equal(row.backlogCanCreate, false);
});
