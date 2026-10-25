import test from "node:test";
import assert from "node:assert/strict";
import {
  isMarketplaceOverviewResponse,
  isMarketplaceTaskResponse,
} from "./marketplace-response";
const now = "2026-10-25T10:00:00.000Z";
const overview = () => ({
  connections: [
    {
      provider: "wildberries",
      configured: false,
      enabled: true,
      clientId: null,
      syncStatus: "never",
      lastSuccessAt: null,
      lastAttemptAt: null,
      message: null,
      warnings: [],
    },
  ],
  products: [
    {
      provider: "wildberries",
      externalId: "listing-1",
      offerId: null,
      name: "Котики",
      barcodes: ["123"],
      skuId: null,
      unitsPerItem: 1,
      suggestedSkuId: null,
    },
  ],
  settings: { historyDays: 28, horizonDays: 14, safetyDays: 3, leadDays: 7 },
  plan: {
    generatedAt: now,
    warnings: [],
    rows: [
      {
        dataComplete: false,
        skuId: "sku",
        skuName: "Котики",
        unitsPerBox: 20,
        averageDailyUnits: 0,
        targetUnits: 0,
        marketplaceUnits: 0,
        inTransitUnits: null,
        readyUnits: 40,
        shippingReadyUnits: 20,
        shipmentReservedUnits: 0,
        openTaskUnits: 20,
        rawAvailableUnits: 1000,
        recommendedUnits: 0,
        recommendedBoxes: 0,
        canCreate: false,
        blockers: ["Данные не загружены"],
        warnings: [],
        proposalHash: "hash",
      },
    ],
  },
});
test("accepts explicit unknown transit and safe catalogue overview", () => {
  assert.equal(isMarketplaceOverviewResponse(overview()), true);
  assert.equal(
    isMarketplaceTaskResponse({ taskId: "task-id", overview: overview() }),
    true,
  );
});
test("rejects malformed top-level and incomplete nested values before UI rendering", () => {
  for (const value of [
    null,
    [],
    {},
    { ...overview(), connections: null },
    { ...overview(), products: [null] },
    { ...overview(), settings: {} },
    { ...overview(), plan: { rows: [] } },
  ])
    assert.equal(isMarketplaceOverviewResponse(value), false);
  assert.equal(
    isMarketplaceTaskResponse({ taskId: "", overview: overview() }),
    false,
  );
  assert.equal(
    isMarketplaceTaskResponse({ taskId: "task-id", overview: {} }),
    false,
  );
});
test("rejects missing completeness, non-finite quantities and bad row structures", () => {
  for (const patch of [
    { dataComplete: undefined },
    { averageDailyUnits: Number.NaN },
    { marketplaceUnits: Infinity },
    { openTaskUnits: -1 },
    { inTransitUnits: undefined },
    { inTransitUnits: 0.5 },
    { blockers: null },
    { warnings: [42] },
    { unitsPerBox: 0 },
  ]) {
    const data = overview();
    Object.assign(data.plan.rows[0]!, patch);
    assert.equal(isMarketplaceOverviewResponse(data), false);
  }
});
test("rejects unknown sync status, malformed nullable timestamp and zero mapping units", () => {
  const state = overview();
  Object.assign(state.connections[0]!, { syncStatus: "verified" });
  assert.equal(isMarketplaceOverviewResponse(state), false);
  const date = overview();
  Object.assign(date.connections[0]!, { lastSuccessAt: "broken" });
  assert.equal(isMarketplaceOverviewResponse(date), false);
  const units = overview();
  units.products[0]!.unitsPerItem = 0;
  assert.equal(isMarketplaceOverviewResponse(units), false);
});
