import { automaticTaskIntents } from "../src/work-automation/planning";
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
          salesForecastKnown: true,
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
  assert.equal(row.recommendedBoxes, 18);
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
  assert.equal(row.assemblyShortageUnits, 600);
  assert.equal(row.recommendedBoxes, 30);
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
  assert.equal(row.recommendedBoxes, 21);
});
test("manual counts add no stock for either assembly or dispatch", () => {
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
  assert.equal(row.readyUnits, 0);
  assert.equal(row.localAfterDispatchUnits, 0);
  assert.equal(row.shippingReadyUnits, 0);
  assert.equal(row.recommendedBoxes, 36);
  m.planningStock![0].accuracy = "approximate";
  assert.deepEqual(marketplacePlan(w, m, now, context).rows[0], row);
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
test("disabled planning SKU consumes capacity only for actual warehouse work", () => {
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
  assert.equal(row.backlogCapacityKnown, true);
  assert.equal(row.backlogCanCreate, true);
  const jobs = automaticTaskIntents(
    w,
    marketplacePlan(w, m, now, context),
    [],
    false,
  );
  assert.deepEqual(
    jobs.map((job) =>
      job.kind === "create" ? [job.skuId, job.boxesTarget] : job.kind,
    ),
    [["sku-cats", 1]],
  );
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

test("monthly preparation adds incremental Saturday legs instead of repeating the first full target", () => {
  const { w, m, context } = fixture();
  const plan = marketplacePlan(w, m, now, context),
    row = plan.rows[0];
  assert.equal(plan.preparationDays, 30);
  assert.equal(plan.preparationThrough, "2026-11-29");
  assert.deepEqual(
    row.weeklyDispatches.map((week) => week.date),
    ["2026-10-31", "2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"],
  );
  assert.deepEqual(
    row.weeklyDispatches.map((week) => week.boxes),
    [8, 6, 8, 6, 8],
  );
  assert.equal(row.outboundBoxes, 8);
  assert.equal(row.monthlyOutboundBoxes, 36);
  assert.equal(row.recommendedBoxes, 36);
  assert.equal(
    row.weeklyDispatches.reduce((sum, week) => sum + week.units, 0),
    row.monthlyOutboundUnits,
  );
  assert.equal(row.monthlyOutboundUnits, 720);
});
test("a covered nearest Saturday still requires assembly for the following month, with own stock and WIP once", () => {
  const { w, m, context } = fixture();
  m.snapshots.forEach((snapshot) => {
    snapshot.stocks[0].availableUnits = 80;
    snapshot.inbound![0].units = 40;
  });
  // First 70 per provider is covered by 120 already at/in transit to that provider.
  for (let i = 0; i < 5; i++) w.boxes.push(physicalBox(`ready-${i}`));
  w.tasks.push({
    id: "work",
    skuId: "sku-cats",
    status: "queued",
    boxesTarget: 2,
    boxesCompleted: 0,
    unitsPerBox: 20,
    reservations: [],
  } as unknown as TaskDto);
  const row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.outboundUnits, 0);
  assert.equal(row.localAfterDispatchUnits, 100);
  assert.equal(row.monthlyOutboundUnits, 480); // Last cumulative 350 minus initial120, rounded to240 each.
  assert.equal(row.openTaskUnits, 40);
  assert.equal(row.recommendedUnits, 340);
  assert.equal(row.localAfterPlannedDispatchUnits, 0);
  assert.equal(row.localAfterAssemblyUnits, 0);
  assert.equal(row.monthlyDispatchShortageUnits, 380);
});
test("calendar window includes only Saturdays inside thirty Moscow dates", () => {
  const { w, m, context } = fixture();
  const sunday = new Date("2026-11-01T09:00:00Z");
  m.snapshots.forEach((snapshot) => {
    snapshot.asOf = sunday.toISOString();
    snapshot.to = "2026-10-31";
  });
  context.goals["sku-cats"].sources!.forEach((source) =>
    source.dailyForecast.forEach((point) => {
      point.date = new Date(Date.parse(point.date) + 86400000)
        .toISOString()
        .slice(0, 10);
    }),
  );
  const plan = marketplacePlan(w, m, sunday, context);
  assert.equal(plan.preparationThrough, "2026-11-30");
  assert.deepEqual(
    plan.rows[0].weeklyDispatches.map((week) => week.date),
    ["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"],
  );
  assert.ok(
    !plan.rows[0].weeklyDispatches.some((week) => week.date === "2026-12-05"),
  );
});
test("weekly legs follow a changing seasonal daily curve instead of repeating an average", () => {
  const { w, m, context } = fixture();
  context.goals["sku-cats"].sources!.forEach((source) =>
    source.dailyForecast.forEach((point, index) => {
      point.units =
        source.provider === "wildberries"
          ? 0
          : index < 7
            ? 10
            : index < 14
              ? 20
              : 0;
    }),
  );
  const row = marketplacePlan(w, m, now, context).rows[0];
  assert.deepEqual(
    row.weeklyDispatches.map((week) => week.boxes),
    [4, 7, 0, 0, 0],
  );
  assert.equal(row.monthlyOutboundBoxes, 11);
  assert.equal(row.outboundBoxes, 4);
});
test("a cached gap beyond the nearest Saturday falls back for the whole provider curve", () => {
  const { w, m, context } = fixture();
  context.goals["sku-cats"].sources![0].dailyForecast.forEach((point) => {
    point.units = 0;
  });
  const ozon = context.goals["sku-cats"].sources![1];
  ozon.dailyForecast = ozon.dailyForecast.filter(
    (point) => point.date !== "2026-11-20",
  );
  m.snapshots[1].demand = [
    {
      externalId: "one",
      date: "2026-10-03",
      orderedUnits: 0,
      cancelledUnits: 0,
      returnedUnits: 0,
      soldUnits: 0,
    },
    {
      externalId: "one",
      date: "2026-10-30",
      orderedUnits: 56,
      cancelledUnits: 0,
      returnedUnits: 0,
      soldUnits: 56,
    },
  ];
  const row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.providers[1].methodLabel, "Текущий спрос");
  assert.equal(row.monthlyOutboundUnits, 80); // 2/day * 35 covered days, four full boxes.
  assert.equal(row.outboundUnits, 20);
});

test("sales forecast is thirty daily quantities independent of stock, with seven-day bins and a partial last bin", () => {
  const { w, m, context } = fixture();
  m.snapshots.forEach((snapshot) => {
    snapshot.stocks[0].availableUnits = 1000;
    snapshot.inbound![0].units = 1000;
  });
  const row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.expectedSalesUnits30, 600);
  assert.equal(row.salesForecastKnown, true);
  assert.deepEqual(
    row.providers.map((provider) => provider.expectedSalesUnits30),
    [300, 300],
  );
  assert.deepEqual(
    row.weeklySales.map((week) => week.units),
    [140, 140, 140, 140, 40],
  );
  assert.deepEqual(
    row.weeklySales.map((week) => [week.from, week.to]),
    [
      ["2026-10-31", "2026-11-06"],
      ["2026-11-07", "2026-11-13"],
      ["2026-11-14", "2026-11-20"],
      ["2026-11-21", "2026-11-27"],
      ["2026-11-28", "2026-11-29"],
    ],
  );
  assert.equal(row.monthlyOutboundUnits, 0);
  assert.equal(
    row.weeklySales.reduce((sum, week) => sum + week.units, 0),
    row.expectedSalesUnits30,
  );
});
test("unknown stock does not hide a known demand forecast; one unknown provider prevents a false complete sales total", () => {
  const { w, m, context } = fixture();
  m.snapshots[0].stocks[0].availableUnits = null;
  let row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.dataComplete, false);
  assert.equal(row.salesForecastKnown, true);
  assert.equal(row.expectedSalesUnits30, 600);
  const wb = context.goals["sku-cats"].sources![0];
  wb.salesForecastKnown = false;
  wb.dailyForecast.forEach((point) => {
    point.units = 0;
  });
  row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(row.salesForecastKnown, false);
  assert.equal(row.providers[0].salesForecastKnown, false);
  assert.equal(row.providers[1].salesForecastKnown, true);
  assert.equal(row.weeklySales[0].providers[0].known, false);
  assert.equal(row.weeklySales[0].providers[1].units, 70);
  wb.salesForecastKnown = true;
  row = marketplacePlan(w, m, now, context).rows[0];
  assert.equal(
    row.salesForecastKnown,
    true,
    "explicit known zero differs from unknown empty history",
  );
});
test("sales weeks start today rather than the next Saturday and preserve fractional forecast units", () => {
  const { w, m, context } = fixture();
  const monday = new Date("2026-10-26T10:00:00Z");
  m.snapshots.forEach((snapshot) => {
    snapshot.asOf = monday.toISOString();
    snapshot.to = "2026-10-25";
  });
  context.goals["sku-cats"].sources!.forEach((source) =>
    source.dailyForecast.forEach((point) => {
      point.date = new Date(Date.parse(point.date) - 5 * 86400000)
        .toISOString()
        .slice(0, 10);
      point.units = 0.25;
    }),
  );
  const plan = marketplacePlan(w, m, monday, context),
    row = plan.rows[0];
  assert.equal(plan.dispatchDate, "2026-10-31");
  assert.equal(row.weeklySales[0].from, "2026-10-26");
  assert.equal(row.weeklySales[0].to, "2026-11-01");
  assert.equal(row.weeklySales.at(-1)!.to, "2026-11-24");
  assert.equal(row.expectedSalesUnits30, 15);
  assert.equal(row.weeklySales[0].units, 3.5);
});

test("empty unobserved sales never become a confirmed zero or a covered assembly recommendation", () => {
  const { w, m } = fixture();
  const row = marketplacePlan(w, m, now).rows[0];
  assert.equal(row.salesForecastKnown, false);
  assert.equal(row.dataComplete, false);
  assert.equal(row.canCreate, false);
  assert.equal(row.advice.state, "review");
  assert.match(row.advice.message, /истории продаж/);
});
test("thirty-day sales curve remains complete when marketplace coverage is only one day", () => {
  const { w, m, context } = fixture();
  m.settings.horizonDays = 1;
  m.settings.leadDays = 0;
  m.settings.safetyDays = 0;
  const monday = new Date("2026-10-26T10:00:00Z");
  m.snapshots.forEach((snapshot) => {
    snapshot.asOf = monday.toISOString();
    snapshot.to = "2026-10-25";
  });
  context.goals["sku-cats"].sources!.forEach((source) =>
    source.dailyForecast.forEach((point, index) => {
      point.date = new Date(Date.parse("2026-10-26") + index * 86400000)
        .toISOString()
        .slice(0, 10);
      point.units = index >= 27 && index < 30 ? 10 : 0;
    }),
  );
  const row = marketplacePlan(w, m, monday, context).rows[0];
  assert.equal(row.salesForecastKnown, true);
  assert.equal(row.expectedSalesUnits30, 60);
  assert.equal(row.weeklySales.at(-1)!.units, 40);
  assert.equal(
    row.monthlyOutboundUnits,
    0,
    "last Saturday needs only days through26; later daily sales still belong to thirty-day prediction",
  );
});
