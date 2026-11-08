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
    {
      externalId: "one",
      date: "2026-09-27",
      orderedUnits: 0,
      cancelledUnits: 0,
      returnedUnits: 0,
      soldUnits: 0,
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
    settings: { ...defaultSettings, dispatchWeekday: 0 },
  };
  return { w, m };
}
test("current full-history forecasts survive a wider recent window but not stale stock or another input key", () => {
  const { w, m } = fixture();
  m.settings.historyDays = 89;
  const sources = m.connections.map((c) => ({
    provider: c.provider,
    salesForecastKnown: true,
    methodLabel: "ML по всей истории",
    confidenceLabel: "Умеренная уверенность",
    scenario: false,
    dailyForecast: Array.from({ length: 150 }, (_, i) => ({
      date: new Date(Date.parse("2026-10-25") + i * 86400000)
        .toISOString()
        .slice(0, 10),
      units: 2,
    })),
  }));
  const context = {
    key: "current",
    cacheCurrent: true,
    minimumBoxes: {},
    goals: {
      "sku-cats": {
        targetUnits: 100,
        methodLabel: "ML",
        confidenceLabel: "Умеренная",
        message: "",
        seasonalityApplied: true,
        sources,
      },
    },
  };
  assert.equal(marketplacePlan(w, m, now, context).rows[0].dataComplete, true);
  assert.equal(
    marketplacePlan(w, m, now, { ...context, cacheCurrent: false }).rows[0]
      .dataComplete,
    false,
  );
  m.snapshots[0].to = "2026-10-23";
  assert.equal(marketplacePlan(w, m, now, context).rows[0].dataComplete, false);
});
test("aggregate WB and Ozon multipacks in internal units, round boxes and count remaining WIP exactly once", () => {
  const { w, m } = fixture();
  let row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.averageDailyUnits, 3);
  assert.equal(row.targetUnits, 72);
  assert.equal(row.marketplaceUnits, 15);
  assert.equal(row.recommendedBoxes, 8);
  assert.equal(row.recommendedUnits, 160);
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
  assert.equal(row.recommendedBoxes, 6);
  w.shipments.push({
    id: "shipment",
    skuId: "sku-cats",
    status: "draft",
    boxIds: ["ready"],
  } as D.ShipmentDto);
  row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.readyUnits, 0);
  assert.equal(row.shipmentReservedUnits, 20);
  assert.equal(row.recommendedBoxes, 6);
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
    {
      externalId: "one",
      date: "2026-09-28",
      orderedUnits: 0,
      cancelledUnits: 0,
      returnedUnits: 0,
      soldUnits: 0,
    },
  ];
  row = marketplacePlan(w, m, afterMoscowMidnight).rows[0];
  assert.equal(row.averageDailyUnits, 2);
  assert.ok(!row.blockers.some((x) => x.includes("недостаточно дней истории")));
});

test("missing data never claims no demand; confirmed zero demand remains a valid no-work result", () => {
  const { w, m } = fixture();
  m.snapshots.forEach((s) => {
    s.demand = [
      {
        externalId: "one",
        date: "2026-10-24",
        orderedUnits: 0,
        cancelledUnits: 0,
        returnedUnits: 0,
        soldUnits: 0,
      },
    ];
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

test("persistent per-product supplies override legacy counters without double counting", () => {
  const { w, m } = fixture();
  m.transit = {};
  m.snapshots.forEach((s) => {
    s.stocks[0].inboundUnits = 9999;
    s.inbound = [
      {
        externalId: "one",
        units: s.provider === "ozon" ? 7 : 0,
        source: s.provider === "ozon" ? "ozon_analytics" : "wb_supplies",
        supplyIds: ["delivery"],
        warnings: [],
      },
      {
        externalId: "unrelated",
        units: null,
        source: "wb_supplies",
        supplyIds: [],
        warnings: ["stale unrelated"],
      },
    ];
  });
  let row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.inTransitUnits, 14);
  assert.equal(row.inboundSource, "api");
  assert.equal(row.inboundSources.length, 2);
  assert.equal(row.dataComplete, true);
  assert.ok(!row.warnings.includes("stale unrelated"));
  m.snapshots[0].inbound![0].units = null;
  m.snapshots[0].inbound![0].warnings = ["Проверьте старую поставку"];
  row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.inTransitUnits, null);
  assert.equal(row.inboundSource, "unknown");
  assert.equal(row.dataComplete, false);
  assert.ok(
    row.warnings.some((warning) =>
      warning.includes("Проверьте старую поставку"),
    ),
  );
  m.transit["sku-cats"] = 0;
  row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.inTransitUnits, 0);
  assert.equal(row.inboundSource, "manual");
  assert.equal(row.dataComplete, true);
});

test("known API zero supplies need no manual confirmation", () => {
  const { w, m } = fixture();
  m.transit = {};
  m.snapshots.forEach((s) => {
    s.inbound = [
      {
        externalId: "one",
        units: 0,
        source: s.provider === "ozon" ? "ozon_analytics" : "wb_supplies",
        supplyIds: [],
        warnings: [],
      },
    ];
  });
  const row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.inTransitUnits, 0);
  assert.equal(row.inboundSource, "api");
  assert.equal(row.dataComplete, true);
});

test("business advice keeps unknown transit unknown and manual confirmation actionable", () => {
  const { w, m } = fixture();
  w.sections = [];
  w.movements = [];
  w.pallets.forEach((p) => {
    p.status = "stored";
  });
  delete m.transit["sku-cats"];
  let row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.inTransitUnits, null);
  assert.equal(row.dataComplete, false);
  assert.equal(row.canCreate, false);
  assert.deepEqual(row.advice, {
    state: "review",
    message: "Проверьте количество товара в пути.",
    action: "transit",
  });
  m.transit["sku-cats"] = 0;
  row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.inTransitUnits, 0);
  assert.equal(row.inboundSource, "manual");
  assert.equal(row.canCreate, true);
  assert.equal(row.advice.state, "ready");
  assert.equal(row.advice.action, "create");
});

test("business advice prioritizes incomplete marketplace data over transit and raw shortage", () => {
  const cases: Array<{
    setup: (m: MarketplaceState) => void;
    message: string;
  }> = [
    {
      setup: (m) => {
        m.snapshots[0].asOf = "2026-10-23T10:00:00Z";
      },
      message: "Обновите данные маркетплейсов.",
    },
    {
      setup: (m) => {
        m.connections[0].syncStatus = "failed";
      },
      message: "Обновите данные маркетплейсов.",
    },
    {
      setup: (m) => {
        m.snapshots[0].stocks[0].availableUnits = null;
      },
      message: "Обновите остатки товара на маркетплейсах.",
    },
    {
      setup: (m) => {
        m.snapshots[0].stocks = [];
      },
      message: "Обновите остатки товара на маркетплейсах.",
    },
    {
      setup: (m) => {
        m.mappings.pop();
      },
      message: "Свяжите товары маркетплейсов с тематиками склада.",
    },
    {
      setup: (m) => {
        m.snapshots[0].to = "2026-10-23";
      },
      message: "Загрузите продажи за весь расчётный период.",
    },
    {
      setup: (m) => {
        m.snapshots = [];
      },
      message: "Загрузите данные маркетплейсов.",
    },
    {
      setup: (m) => {
        m.snapshots[0].coverage.demand = false;
      },
      message: "Обновите данные маркетплейсов.",
    },
  ];
  for (const entry of cases) {
    const { w, m } = fixture();
    delete m.transit["sku-cats"];
    w.pallets = [];
    entry.setup(m);
    const row = marketplacePlan(w, m, now).rows[0];
    assert.equal(row.dataComplete, false);
    assert.equal(row.canCreate, false);
    assert.deepEqual(row.advice, {
      state: "review",
      message: entry.message,
      action: "integrations",
    });
    assert.doesNotMatch(
      row.advice.message,
      /API|coverage|snapshot|DTO|wildberries|ozon|\bone\b/,
    );
  }
});

test("business advice asks for receiving only placed and free raw stock can satisfy assembly", () => {
  const { w, m } = fixture();
  // Incoming raw physically outside an active address remains unavailable.
  w.pallets = w.pallets.map((p) => ({
    ...p,
    status: "awaiting_placement",
    locationId: null,
  }));
  const row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.dataComplete, true);
  assert.equal(row.recommendedBoxes, 8);
  assert.equal(row.rawAvailableUnits, 0);
  assert.equal(row.canCreate, false);
  assert.deepEqual(row.advice, {
    state: "raw_shortage",
    message: "Примите и разместите товар: не хватает 20 шт.",
    action: "receiving",
  });
});

test("business advice distinguishes covered demand from unknown quantities without raw stock", () => {
  const { w, m } = fixture();
  w.pallets = [];
  m.snapshots.forEach((s) => {
    s.demand = [
      {
        externalId: "one",
        date: "2026-10-24",
        orderedUnits: 0,
        cancelledUnits: 0,
        returnedUnits: 0,
        soldUnits: 0,
      },
    ];
  });
  let row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.dataComplete, true);
  assert.equal(row.recommendedBoxes, 0);
  assert.equal(row.canCreate, false);
  assert.deepEqual(row.advice, {
    state: "covered",
    message: "Запаса и текущей сборки достаточно.",
    action: "none",
  });
  delete m.transit["sku-cats"];
  row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.inTransitUnits, null);
  assert.equal(row.dataComplete, false);
  assert.equal(row.advice.state, "review");
  assert.equal(row.advice.action, "transit");
});

test("large recommendations still allow an individual box task", () => {
  const { w, m } = fixture();
  w.sections = [];
  w.movements = [];
  w.pallets.forEach((p) => {
    p.status = "stored";
  });
  m.snapshots[0].demand[0].orderedUnits = 100000;
  w.pallets.forEach((p) => {
    p.quantity = 1000000;
  });
  const row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.dataComplete, true);
  assert.ok(row.recommendedBoxes > 1000);
  assert.ok(row.rawAvailableUnits > row.recommendedUnits);
  assert.equal(row.canCreate, true);
  assert.equal(row.advice.state, "ready");
  assert.equal(row.advice.action, "create");
});

test("automatic refresh keeps a fresh verified version usable, while stale or replaced credentials and manual pending remain blocked", () => {
  const { w, m } = fixture();
  const c = m.connections[0];
  c.syncStatus = "running";
  c.syncMode = "automatic";
  c.lastSuccessVersion = c.version;
  assert.equal(marketplacePlan(w, m, now).rows[0].dataComplete, true);
  c.version++;
  assert.equal(marketplacePlan(w, m, now).rows[0].dataComplete, false);
  c.version--;
  c.syncMode = "manual";
  assert.equal(marketplacePlan(w, m, now).rows[0].dataComplete, false);
  c.syncMode = "automatic";
  m.snapshots[0].asOf = "2026-10-23T10:00:00Z";
  assert.equal(marketplacePlan(w, m, now).rows[0].dataComplete, false);
});

test("seasonal goals preserve stock deductions, unknown blockers and invalidate an old proposal", () => {
  const { w, m } = fixture();
  const baseline = marketplacePlan(w, m, now).rows[0];
  const context = {
    key: "history-v1",
    goals: {
      "sku-cats": {
        targetUnits: 200,
        methodLabel: "Прогноз с сезонностью",
        confidenceLabel: "Умеренная уверенность",
        message: "Проверено на прошлом",
        seasonalityApplied: true,
        sources: (["wildberries", "ozon"] as const).map((provider) => ({
          provider,
          methodLabel: "Прогноз с сезонностью",
          confidenceLabel: "Умеренная уверенность",
          scenario: false,
          dailyForecast: Array.from({ length: 60 }, (_, i) => ({
            date: new Date(Date.parse("2026-10-25") + i * 86400000)
              .toISOString()
              .slice(0, 10),
            units: 100 / 24,
          })),
        })),
      },
    },
    minimumBoxes: { "sku-cats": 0 },
  };
  const row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.targetUnits, 200);
  assert.equal(row.marketplaceUnits, 15);
  assert.equal(row.recommendedBoxes, 22);
  assert.notEqual(row.proposalHash, baseline.proposalHash);
  assert.notEqual(
    row.proposalHash,
    marketplacePlan(w, m, now, { ...context, key: "history-v2" }).rows[0]
      .proposalHash,
  );
  const fallback = { ...context, goals: {} };
  assert.notEqual(
    row.proposalHash,
    marketplacePlan(w, m, now, fallback).rows[0].proposalHash,
    "publishing cached model invalidates fallback proposal even under same input key",
  );
  delete m.transit["sku-cats"];
  const incomplete = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(incomplete.dataComplete, false);
  assert.equal(incomplete.canCreate, false);
});

test("explicit minimum stock policy remains optional preparation and never invents dispatch demand", () => {
  const { w, m } = fixture();
  m.snapshots.forEach((s) => {
    s.demand = [
      {
        externalId: "one",
        date: "2026-10-24",
        orderedUnits: 0,
        cancelledUnits: 0,
        returnedUnits: 0,
        soldUnits: 0,
      },
    ];
    s.stocks[0].availableUnits = 0;
  });
  const context = { key: "policy", goals: {}, minimumBoxes: { "sku-cats": 2 } };
  let row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.targetUnits, 40);
  assert.equal(row.recommendedBoxes, 0);
  assert.equal(row.outboundBoxes, 0);
  assert.equal(row.backlogRank, 1);
  w.boxes.push({
    id: "ready",
    skuId: "sku-cats",
    units: 20,
    status: "stored",
  } as D.BoxDto);
  row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.recommendedBoxes, 0);
});

test("transient history page leases do not invalidate an unchanged assembly proposal", () => {
  const { w, m } = fixture();
  const before = marketplacePlan(w, m, now).rows[0].proposalHash;
  m.connections[0].historyLease = {
    runId: "page-1",
    until: new Date(now.getTime() + 180000).toISOString(),
  };
  assert.equal(marketplacePlan(w, m, now).rows[0].proposalHash, before);
  m.connections[0].version++;
  assert.notEqual(marketplacePlan(w, m, now).rows[0].proposalHash, before);
});
