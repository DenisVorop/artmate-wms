import type { WorkspaceDto } from "../src/dto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedWorkspace } from "../src/seed";
import { marketplacePlan } from "../src/marketplaces/planning";
import {
  defaultSettings,
  type MarketplaceState,
} from "../src/marketplaces/storage";
import {
  outgoingSupplyKeys,
  type PlanningStockConfirmation,
} from "../src/marketplaces/planning-stock";
import type { ForecastPlanContext } from "../src/forecasting/forecast-storage";
import type { MarketplaceSupply } from "../src/marketplaces/providers/types";
const now = new Date("2026-10-26T12:00:00Z");
function fixture() {
  const w: WorkspaceDto = seedWorkspace(),
    template = w.boxes.find((b) => b.skuId === "sku-cats")!;
  w.boxes = [structuredClone(template)];
  w.tasks = [];
  w.shipments = [];
  const m: MarketplaceState = {
    connections: [
      {
        provider: "ozon",
        clientId: "seller",
        encrypted: "opaque",
        enabled: true,
        version: 1,
        syncStatus: "success",
        runId: null,
        lastAttemptAt: now.toISOString(),
        lastSuccessAt: now.toISOString(),
        message: null,
        warnings: [],
      },
    ],
    snapshots: [
      {
        provider: "ozon",
        from: "2026-09-01",
        to: "2026-10-25",
        asOf: now.toISOString(),
        products: [{ externalId: "sku", name: "Котики", barcodes: [] }],
        stocks: [
          {
            externalId: "sku",
            warehouseId: "one",
            warehouseName: "one",
            availableUnits: 0,
            reservedUnits: null,
            inboundUnits: 0,
          },
        ],
        demand: [],
        supplies: [],
        inbound: [
          {
            externalId: "sku",
            units: 0,
            source: "ozon_analytics",
            supplyIds: [],
            warnings: [],
          },
        ],
        coverage: { catalog: true, stocks: true, demand: true, inbound: true },
        warnings: [],
      },
    ],
    mappings: [
      {
        provider: "ozon",
        externalId: "sku",
        skuId: "sku-cats",
        unitsPerItem: 1,
      },
    ],
    transit: {},
    settings: { ...defaultSettings, dispatchWeekday: 1 },
    planningStock: [],
  };
  const confirmation: PlanningStockConfirmation = {
    skuId: "sku-cats",
    enabled: true,
    units: 100,
    accuracy: "exact",
    note: "Пересчёт",
    unitsPerBoxAtCount: 20,
    trackedUnitsAtCount: 20,
    countedAt: now.toISOString(),
    actorAccountId: "manager",
    revision: 1,
    outboundSupplyKeys: [],
  };
  m.planningStock = [confirmation];
  const forecast: ForecastPlanContext = {
    key: "forecast",
    minimumBoxes: {},
    goals: {
      "sku-cats": {
        targetUnits: 1000,
        methodLabel: "Средний спрос",
        confidenceLabel: "Оценка",
        message: "",
        seasonalityApplied: false,
        sources: [
          {
            provider: "ozon",
            methodLabel: "Средний спрос",
            confidenceLabel: "Оценка",
            scenario: false,
            dailyForecast: Array.from({ length: 24 }, (_, i) => ({
              date: new Date(Date.parse("2026-10-26") + i * 86400000)
                .toISOString()
                .slice(0, 10),
              units: 1000 / 24,
            })),
          },
        ],
      },
    },
  };
  const row = () =>
    marketplacePlan(w, m, now, forecast).rows.find(
      (r) => r.skuId === "sku-cats",
    )!;
  return { w, m, confirmation, template, row };
}
const supply = (
  id: string,
  calculation: MarketplaceSupply["calculation"] = "analytics",
): MarketplaceSupply => ({
  id,
  statusCode: calculation === "excluded" ? "READY_TO_SUPPLY" : "IN_TRANSIT",
  statusLabel: "Поставка",
  expectedAt: null,
  receivedAt: null,
  updatedAt: null,
  calculation,
  items: [
    {
      externalId: "sku",
      name: "Котики",
      plannedUnits: 20,
      acceptedUnits: null,
      readyUnits: null,
      pendingUnits: 20,
    },
  ],
  warnings: [],
});
test("confirmed totals offset tracked units once; new assembly, shipment and draft reservation do not double count", () => {
  const f = fixture();
  let row = f.row();
  assert.equal(row.readyUnits, 100);
  assert.equal(row.unregisteredUnits, 80);
  assert.equal(row.shippingReadyUnits, 0);
  assert.equal(row.recommendedUnits, 900);
  f.w.boxes.push({
    ...structuredClone(f.template),
    id: "new-box",
    code: "NEW",
  });
  row = f.row();
  assert.equal(row.readyUnits, 120);
  assert.equal(row.recommendedUnits, 880);
  f.w.shipments.push({
    id: "draft",
    code: "DRAFT",
    boxesRequested: 1,
    boxIds: [f.template.id],
    status: "draft",
  } as any);
  row = f.row();
  assert.equal(row.readyUnits, 100);
  assert.equal(row.shipmentReservedUnits, 20);
  assert.equal(row.recommendedUnits, 880);
  f.w.shipments[0].status = "shipped";
  f.w.boxes[0].status = "shipped";
  row = f.row();
  assert.equal(row.readyUnits, 100);
  assert.equal(row.shipmentReservedUnits, 0);
  assert.equal(row.recommendedUnits, 900);
  assert.equal(row.shippingReadyUnits, 0);
});
test("excluded products disappear; unknown or approximate counts stay explicit review and cannot create tasks", () => {
  const f = fixture();
  f.confirmation.enabled = false;
  assert.equal(f.row(), undefined);
  f.confirmation.enabled = true;
  for (const patch of [
    { accuracy: "approximate" as const, units: 300 },
    { accuracy: "exact" as const, units: null },
  ]) {
    Object.assign(f.confirmation, patch);
    const row = f.row();
    assert.equal(row.dataComplete, false);
    assert.equal(row.canCreate, false);
    assert.equal(row.stockEstimated, true);
    assert.equal(row.advice.state, "review");
    assert.equal(row.advice.action, "none");
  }
});
test("negative opening offset, changed box size and an expired unregistered count block the recommendation", () => {
  for (const patch of [
    { units: 0 },
    { unitsPerBoxAtCount: 4 },
    { countedAt: "2026-10-19T12:00:00Z" },
  ]) {
    const f = fixture();
    Object.assign(f.confirmation, patch);
    const row = f.row();
    assert.equal(row.dataComplete, false);
    assert.equal(row.canCreate, false);
    assert.equal(row.advice.action, "none");
    assert.ok(row.unregisteredUnits >= 0);
  }
  const f = fixture();
  f.confirmation.units = 20;
  f.confirmation.countedAt = "2026-09-01T12:00:00Z";
  assert.equal(f.row().dataComplete, true);
});
test("a new dispatched supply requests recount, while known documents updating quantities/timestamps do not", () => {
  const f = fixture();
  f.m.snapshots[0].supplies = [supply("old")];
  f.confirmation.outboundSupplyKeys = outgoingSupplyKeys(f.m, "sku-cats");
  assert.equal(f.row().dataComplete, true);
  f.m.snapshots[0].supplies![0].updatedAt = "2026-10-26T12:30:00Z";
  f.m.snapshots[0].supplies![0].items[0].pendingUnits = 10;
  assert.equal(f.row().dataComplete, true);
  f.m.snapshots[0].supplies![0].items[0].acceptedUnits = 10;
  f.m.snapshots[0].supplies![0].items[0].readyUnits = 5;
  assert.equal(f.row().dataComplete, true);
  f.m.snapshots[0].supplies![0].items[0].plannedUnits = 40;
  assert.equal(f.row().dataComplete, false);
  f.m.snapshots[0].supplies![0].items[0].plannedUnits = 20;
  assert.equal(f.row().dataComplete, true);
  f.m.snapshots[0].supplies!.push(supply("draft", "excluded"));
  assert.equal(f.row().dataComplete, true);
  f.m.snapshots[0].supplies!.at(-1)!.calculation = "analytics";
  assert.equal(f.row().dataComplete, false);
  assert.match(f.row().advice.message, /поставка/);
});
test("confirmation revisions and source counts participate in task proposal identity", () => {
  const f = fixture(),
    before = f.row().proposalHash;
  f.confirmation.revision++;
  assert.notEqual(f.row().proposalHash, before);
  const next = f.row().proposalHash;
  f.confirmation.units = 120;
  assert.notEqual(f.row().proposalHash, next);
});

test("outgoing evidence canonicalizes duplicate SKU rows and ignores item ordering", () => {
  const f = fixture();
  const doc = supply("composition");
  doc.items.push({ ...doc.items[0], plannedUnits: 10 });
  f.m.snapshots[0].supplies = [doc];
  const duplicate = outgoingSupplyKeys(f.m, "sku-cats");
  doc.items = [{ ...doc.items[0], plannedUnits: 30 }];
  assert.deepEqual(outgoingSupplyKeys(f.m, "sku-cats"), duplicate);
  doc.items[0].plannedUnits = null;
  assert.notDeepEqual(outgoingSupplyKeys(f.m, "sku-cats"), duplicate);
});
