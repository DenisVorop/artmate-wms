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
            salesForecastKnown: true,
            methodLabel: "Средний спрос",
            confidenceLabel: "Оценка",
            scenario: false,
            dailyForecast: Array.from({ length: 60 }, (_, i) => ({
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
test("registered ready boxes follow assembly, reservations and shipments without using manual balances", () => {
  const { w, template, row } = fixture();
  assert.equal(row().readyUnits, 20);
  assert.equal(row().shippingReadyUnits, 0);
  assert.equal(row().recommendedUnits, row().monthlyOutboundUnits - 20);
  w.boxes.push({ ...structuredClone(template), id: "new-box", code: "NEW" });
  assert.equal(row().readyUnits, 40);
  w.shipments.push({
    id: "draft",
    code: "DRAFT",
    boxesRequested: 1,
    boxIds: [template.id],
    status: "draft",
  } as any);
  assert.equal(row().readyUnits, 20);
  assert.equal(row().shipmentReservedUnits, 20);
  assert.equal(row().recommendedUnits, row().monthlyOutboundUnits - 40);
  w.shipments[0].status = "shipped";
  w.boxes[0].status = "shipped";
  assert.equal(row().readyUnits, 20);
  assert.equal(row().shipmentReservedUnits, 0);
  assert.equal(row().recommendedUnits, row().monthlyOutboundUnits - 20);
});

test("historical exact, approximate and missing counts cannot change quantities, review or task identity", () => {
  const { m, confirmation, row } = fixture();
  m.planningStock = [];
  const baseline = row();
  assert.equal(baseline.dataComplete, true);
  assert.equal(baseline.unregisteredUnits, 0);
  for (const patch of [
    { units: 100, countedAt: "2026-10-19T12:00:00Z" },
    { units: 300, accuracy: "approximate" as const },
    { units: null, accuracy: "exact" as const },
    { units: 0, unitsPerBoxAtCount: 4 },
  ]) {
    m.planningStock = [{ ...confirmation, ...patch }];
    assert.deepEqual(row(), baseline);
  }
  m.planningStock = [{ ...confirmation, enabled: false }];
  assert.equal(row(), undefined);
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
