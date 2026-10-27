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
  supplies: [
    {
      provider: "wildberries",
      id: "supply-1",
      statusCode: "5",
      statusLabel: "Приёмка разрешена",
      expectedAt: now,
      receivedAt: null,
      updatedAt: now,
      calculation: "document",
      warnings: [],
      items: [
        {
          externalId: "listing-1",
          name: "Котики",
          skuId: null,
          plannedUnits: 20,
          acceptedUnits: null,
          readyUnits: null,
          pendingUnits: 20,
        },
      ],
    },
  ],
  settings: { historyDays: 28, horizonDays: 14, safetyDays: 3, leadDays: 7 },
  planningStock: [],
  previousPlan: null,
  planStatus: {
    state: "current",
    calculatedAt: now,
    dataUpdatedAt: now,
    salesThrough: "2026-10-24",
    message: "",
  },
  plan: {
    preparationDays: 30,
    preparationThrough: "2026-11-23",
    generatedAt: now,
    dispatchDate: "2026-10-31",
    leadDays: 7,
    horizonDays: 14,
    safetyDays: 3,
    backlogMessage:
      "Следующая тематика выбирается по спросу и свободным местам.",
    warnings: [],
    rows: [
      {
        providers: [
          {
            provider: "wildberries",
            expectedSalesUnits30: 0,
            salesForecastKnown: false,
            averageDailyUnits: 0,
            targetUnits: 0,
            marketplaceUnits: null,
            inTransitUnits: null,
            dispatchBoxes: 0,
            dispatchUnits: 0,
            dataComplete: false,
            methodLabel: "Недостаточно данных",
            confidenceLabel: "Низкая",
            scenario: false,
          },
        ],
        expectedSalesUnits30: 0,
        salesForecastKnown: false,
        weeklySales: [
          {
            from: "2026-10-26",
            to: "2026-11-01",
            units: 0,
            providers: [{ provider: "wildberries", units: 0, known: false }],
          },
        ],
        monthlyOutboundBoxes: 0,
        monthlyOutboundUnits: 0,
        localAfterPlannedDispatchUnits: 0,
        monthlyDispatchShortageUnits: 0,
        weeklyDispatches: [
          { date: "2026-10-31", boxes: 0, units: 0, providers: [] },
        ],
        outboundBoxes: 0,
        outboundUnits: 0,
        newOutboundBoxes: 0,
        newOutboundUnits: 0,
        localAfterDispatchUnits: 0,
        dispatchShortageUnits: 0,
        assemblyShortageUnits: 0,
        localAfterAssemblyUnits: 0,
        backlogBoxes: 0,
        backlogUnits: 0,
        backlogRank: null,
        backlogCapacityKnown: false,
        backlogCanCreate: false,
        backlogReason: "Нужно подтвердить свободные места.",
        advice: {
          state: "review",
          message: "Уточните поставки",
          action: "transit",
        },
        dataComplete: false,
        skuId: "sku",
        skuName: "Котики",
        unitsPerBox: 20,
        averageDailyUnits: 0,
        targetUnits: 0,
        marketplaceUnits: 0,
        inTransitUnits: null,
        inboundSource: "unknown",
        inboundSources: [
          {
            provider: "wildberries",
            units: null,
            source: "unknown",
            asOf: null,
            supplyCount: 0,
            warnings: [],
          },
        ],
        readyUnits: 40,
        unregisteredUnits: 0,
        stockConfirmedAt: null,
        stockEstimated: false,
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
    { unregisteredUnits: undefined },
    { unregisteredUnits: -20 },
    { stockConfirmedAt: "yesterday" },
    { stockEstimated: undefined },
    { advice: undefined },
    { advice: { state: "ready", message: "Можно собирать", action: "unsafe" } },
    { advice: { state: "unknown", message: "Проверьте", action: "none" } },
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

test("requires provenance and supply documents rather than silently accepting an older response", () => {
  for (const patch of [
    { inboundSource: undefined },
    { inboundSources: undefined },
    { inboundSource: "guessed" },
    { inboundSources: [null] },
    {
      inboundSources: [
        {
          provider: "ozon",
          units: undefined,
          source: "ozon_analytics",
          asOf: now,
          supplyCount: 1,
          warnings: [],
        },
      ],
    },
  ]) {
    const data = overview();
    Object.assign(data.plan.rows[0]!, patch);
    assert.equal(isMarketplaceOverviewResponse(data), false);
  }
  assert.equal(
    isMarketplaceOverviewResponse({ ...overview(), supplies: undefined }),
    false,
  );
});
test("accepts known zero and explicit unknown supply quantities without conflating them", () => {
  const data = overview();
  Object.assign(data.plan.rows[0]!, {
    inTransitUnits: 0,
    inboundSource: "api",
    inboundSources: [
      {
        provider: "wildberries",
        units: 0,
        source: "wb_supplies",
        asOf: now,
        supplyCount: 0,
        warnings: [],
      },
      {
        provider: "ozon",
        units: 0,
        source: "ozon_analytics",
        asOf: now,
        supplyCount: 1,
        warnings: [],
      },
    ],
  });
  Object.assign(data.supplies[0]!.items[0]!, {
    plannedUnits: null,
    acceptedUnits: 0,
    readyUnits: null,
    pendingUnits: null,
  });
  assert.equal(isMarketplaceOverviewResponse(data), true);
});
test("rejects malformed document dates, quantities, review status and source metadata", () => {
  for (const patch of [
    { expectedAt: "tomorrow" },
    { calculation: "added" },
    { warnings: [false] },
    { items: [null] },
    { statusLabel: undefined },
  ]) {
    const data = overview();
    Object.assign(data.supplies[0]!, patch);
    assert.equal(isMarketplaceOverviewResponse(data), false);
  }
  for (const patch of [
    { plannedUnits: -1 },
    { pendingUnits: undefined },
    { acceptedUnits: Infinity },
    { readyUnits: 0.5 },
  ]) {
    const data = overview();
    Object.assign(data.supplies[0]!.items[0]!, patch);
    assert.equal(isMarketplaceOverviewResponse(data), false);
  }
  for (const patch of [
    { source: "client_guess" },
    { asOf: "yesterday" },
    { supplyCount: -1 },
    { units: 0.5 },
    { provider: "other" },
  ]) {
    const data = overview();
    Object.assign(data.plan.rows[0]!.inboundSources[0]!, patch);
    assert.equal(isMarketplaceOverviewResponse(data), false);
  }
});

test("requires stock confirmation provenance and distinguishes approximate from missing stock", () => {
  const confirmation = {
    skuId: "sku",
    enabled: true,
    units: 300,
    accuracy: "approximate",
    note: "Около трёхсот наборов",
    countedAt: now,
    unitsPerBoxAtCount: 4,
    trackedUnitsAtCount: 0,
    revision: 1,
  };
  assert.equal(
    isMarketplaceOverviewResponse({
      ...overview(),
      planningStock: [confirmation],
    }),
    true,
  );
  for (const patch of [
    { units: -1 },
    { accuracy: "guessed" },
    { countedAt: "tomorrow" },
    { trackedUnitsAtCount: Number.NaN },
    { revision: -1 },
    { unitsPerBoxAtCount: 0 },
  ]) {
    assert.equal(
      isMarketplaceOverviewResponse({
        ...overview(),
        planningStock: [{ ...confirmation, ...patch }],
      }),
      false,
    );
  }
  assert.equal(
    isMarketplaceOverviewResponse({ ...overview(), planningStock: undefined }),
    false,
  );
});

test("unified quantities and provider completeness are required before totals render", () => {
  for (const patch of [
    { outboundBoxes: undefined },
    { outboundUnits: -1 },
    { localAfterDispatchUnits: NaN },
    { providers: [null] },
    { backlogRank: 0 },
    { backlogCanCreate: undefined },
    { backlogCapacityKnown: undefined },
  ]) {
    const data = overview();
    Object.assign(data.plan.rows[0]!, patch);
    assert.equal(isMarketplaceOverviewResponse(data), false);
  }
  for (const patch of [
    { marketplaceUnits: undefined },
    { inTransitUnits: -1 },
    { scenario: undefined },
    { dispatchBoxes: 0.5 },
  ]) {
    const data = overview();
    Object.assign(data.plan.rows[0]!.providers[0]!, patch);
    assert.equal(isMarketplaceOverviewResponse(data), false);
  }
  const data = overview();
  Object.assign(data.plan, { dispatchDate: "Saturday" });
  assert.equal(isMarketplaceOverviewResponse(data), false);
});

test("monthly plan rejects missing weekly coverage or invalid quantities", () => {
  for (const patch of [
    { monthlyOutboundBoxes: undefined },
    { monthlyOutboundUnits: -1 },
    { localAfterPlannedDispatchUnits: NaN },
    { weeklyDispatches: undefined },
    { weeklyDispatches: [{ date: "bad", boxes: 0, units: 0, providers: [] }] },
  ]) {
    const value = overview();
    Object.assign(value.plan.rows[0]!, patch);
    assert.equal(isMarketplaceOverviewResponse(value), false);
  }
  const value = overview();
  Object.assign(value.plan, { preparationThrough: undefined });
  assert.equal(isMarketplaceOverviewResponse(value), false);
});

test("sales forecasts require per-theme quantities and explicit known flags independently of stock", () => {
  for (const patch of [
    { expectedSalesUnits30: NaN },
    { salesForecastKnown: undefined },
    { weeklySales: undefined },
    {
      weeklySales: [
        { from: "tomorrow", to: "2026-11-01", units: 2, providers: [] },
      ],
    },
  ]) {
    const x = overview();
    Object.assign(x.plan.rows[0]!, patch);
    assert.equal(isMarketplaceOverviewResponse(x), false);
  }
  const x = overview();
  Object.assign(x.plan.rows[0]!, {
    expectedSalesUnits30: 15.5,
    salesForecastKnown: true,
  });
  assert.equal(isMarketplaceOverviewResponse(x), true);
});

test("background plan status and previous snapshot are validated, including disabled commands", () => {
  const current = overview();
  const previous = structuredClone(current.plan);
  for (const row of previous.rows)
    Object.assign(row, { canCreate: false, backlogCanCreate: false });
  assert.equal(
    isMarketplaceOverviewResponse({
      ...current,
      previousPlan: previous,
      planStatus: { ...current.planStatus, state: "previous" },
    }),
    true,
  );
  assert.equal(
    isMarketplaceOverviewResponse({
      ...current,
      previousPlan: {
        ...previous,
        rows: [{ ...previous.rows[0], canCreate: true }],
      },
    }),
    false,
  );
  assert.equal(
    isMarketplaceOverviewResponse({
      ...current,
      previousPlan: {
        ...previous,
        rows: [{ ...previous.rows[0], backlogCanCreate: true }],
      },
    }),
    false,
  );
  for (const planStatus of [
    undefined,
    { ...current.planStatus, state: "ready" },
    { ...current.planStatus, calculatedAt: "oops" },
  ])
    assert.equal(
      isMarketplaceOverviewResponse({ ...current, planStatus }),
      false,
    );
});
