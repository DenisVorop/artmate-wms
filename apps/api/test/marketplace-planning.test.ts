import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedWorkspace } from "../src/seed";
import { marketplacePlan } from "../src/marketplaces/planning";
import {
  MarketplaceState,
  defaultSettings,
  Connection,
} from "../src/marketplaces/storage";
import { MarketplaceSnapshot } from "../src/marketplaces/providers/types";
import * as D from "../src/dto";
const now = new Date("2026-10-25T12:00:00Z");
const connection = (provider: Connection["provider"]): Connection => ({
  provider,
  encrypted: "ciphertext",
  clientId: null,
  enabled: true,
  version: 1,
  syncStatus: "success",
  lastAttemptAt: now.toISOString(),
  lastSuccessAt: now.toISOString(),
  message: null,
  warnings: [],
  runId: null,
});
const snapshot = (
  provider: MarketplaceSnapshot["provider"],
): MarketplaceSnapshot => ({
  provider,
  asOf: now.toISOString(),
  from: "2026-08-30",
  to: "2026-10-24",
  products: [{ externalId: "one", name: "one", barcodes: [] }],
  stocks: [
    {
      externalId: "one",
      warehouseId: "x",
      warehouseName: "x",
      availableUnits: 5,
      reservedUnits: 0,
      inboundUnits: null,
    },
  ],
  demand: [
    {
      externalId: "one",
      date: "2026-10-20",
      orderedUnits: 30,
      cancelledUnits: 2,
      returnedUnits: 1,
      soldUnits: 27,
    },
  ],
  coverage: { catalog: true, stocks: true, demand: true, inbound: false },
  warnings: [],
});
function fixture() {
  const w: D.WorkspaceDto = seedWorkspace();
  w.tasks = [];
  w.boxes = [];
  w.shipments = [];
  const m: MarketplaceState = {
    connections: [connection("wildberries"), connection("ozon")],
    snapshots: [snapshot("wildberries"), snapshot("ozon")],
    mappings: [
      {
        provider: "wildberries",
        externalId: "one",
        skuId: "sku-cats",
        unitsPerItem: 1,
      },
      {
        provider: "ozon",
        externalId: "one",
        skuId: "sku-cats",
        unitsPerItem: 2,
      },
    ],
    transit: { "sku-cats": 0 },
    settings: { ...defaultSettings },
  };
  return { w, m };
}
test("aggregate WB and Ozon multipacks in internal units, round boxes and count remaining WIP exactly once", () => {
  const { w, m } = fixture();
  let row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.averageDailyUnits, 3);
  assert.equal(row.targetUnits, 72);
  assert.equal(row.marketplaceUnits, 15);
  assert.equal(row.recommendedBoxes, 3);
  assert.equal(row.recommendedUnits, 60);
  w.tasks.push({
    id: "work",
    skuId: "sku-cats",
    status: "active",
    boxesTarget: 2,
    boxesCompleted: 1,
    unitsPerBox: 20,
    scannedUnits: 10,
    reservations: [],
    openBoxContents: [{ lotId: "lot", quantity: 10 }],
  } as unknown as D.TaskDto);
  w.boxes.push({
    id: "ready",
    skuId: "sku-cats",
    units: 20,
    status: "stored",
    palletId: "assembly",
    locationId: "assembly",
  } as D.BoxDto);
  row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.openTaskUnits, 20);
  assert.equal(row.readyUnits, 20);
  assert.equal(row.shippingReadyUnits, 0);
  assert.equal(row.recommendedBoxes, 1);
  w.shipments.push({
    id: "shipment",
    skuId: "sku-cats",
    status: "draft",
    boxIds: ["ready"],
  } as D.ShipmentDto);
  row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.readyUnits, 0);
  assert.equal(row.shipmentReservedUnits, 20);
  assert.equal(row.recommendedBoxes, 1);
});
test("unknown/stale/incomplete/unmapped data blocks publication; unplaced raw is never capacity", () => {
  const { w, m } = fixture();
  delete m.transit["sku-cats"];
  let row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.inTransitUnits, null);
  assert.equal(row.canCreate, false);
  assert.match(row.blockers.join(" "), /Подтвердите/);
  m.transit["sku-cats"] = 0;
  m.snapshots[0].asOf = "2026-10-23T10:00:00Z";
  assert.match(
    marketplacePlan(w, m, now).rows[0].blockers.join(" "),
    /24 часов/,
  );
  m.snapshots[0].asOf = now.toISOString();
  m.snapshots[0].stocks[0].availableUnits = null;
  assert.match(
    marketplacePlan(w, m, now).rows[0].blockers.join(" "),
    /неизвестен/,
  );
  m.snapshots[0].stocks[0].availableUnits = 5;
  m.mappings.pop();
  assert.match(
    marketplacePlan(w, m, now).rows[0].blockers.join(" "),
    /сопоставьте/,
  );
  w.pallets = w.pallets.map((p) => ({
    ...p,
    status: "awaiting_placement",
    locationId: null,
  }));
  assert.equal(marketplacePlan(w, m, now).rows[0].rawAvailableUnits, 0);
});

test("forecast uses completed Moscow days across UTC midnight and known API transit before a manual override", () => {
  const { w, m } = fixture();
  m.connections = [connection("ozon")];
  m.snapshots = [snapshot("ozon")];
  m.mappings = m.mappings.filter((x) => x.provider === "ozon");
  m.transit = {};
  m.snapshots[0].coverage.inbound = true;
  m.snapshots[0].stocks[0].inboundUnits = 7;
  let row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.inTransitUnits, 14, "API inbound respects unitsPerItem");
  m.transit["sku-cats"] = 0;
  assert.equal(
    marketplacePlan(w, m, now).rows[0].inTransitUnits,
    0,
    "explicit manual zero overrides API",
  );
  const afterMoscowMidnight = new Date("2026-10-25T21:30:00Z");
  m.snapshots[0].asOf = afterMoscowMidnight.toISOString();
  row = marketplacePlan(w, m, afterMoscowMidnight).rows[0];
  assert.match(
    row.blockers.join(" "),
    /недостаточно дней истории/,
    "yesterday in Moscow is now October25",
  );
  m.snapshots[0].to = "2026-10-25";
  m.snapshots[0].demand = [
    {
      externalId: "one",
      date: "2026-10-25",
      orderedUnits: 28,
      cancelledUnits: 0,
      returnedUnits: 0,
      soldUnits: null,
    },
  ];
  row = marketplacePlan(w, m, afterMoscowMidnight).rows[0];
  assert.equal(row.averageDailyUnits, 2);
  assert.ok(!row.blockers.some((x) => x.includes("недостаточно дней истории")));
});

test("missing data never claims no demand; confirmed zero demand remains a valid no-work result", () => {
  const { w, m } = fixture();
  m.snapshots.forEach((s) => {
    s.demand = [];
    s.stocks[0].availableUnits = 0;
  });
  delete m.transit["sku-cats"];
  let row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.dataComplete, false);
  assert.ok(!row.blockers.some((reason) => reason.includes("не требуется")));
  m.transit["sku-cats"] = 0;
  row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.dataComplete, true);
  assert.equal(row.recommendedBoxes, 0);
  assert.ok(row.blockers.some((reason) => reason.includes("не требуется")));
});
