import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../src/database";
import type { WorkspaceDto } from "../src/dto";
import { seedWorkspace } from "../src/seed";
import type { ForecastPlanContext } from "../src/forecasting/forecast-storage";
import { forecastInputKey } from "../src/forecasting/forecast-storage";
import { marketplacePlan } from "../src/marketplaces/planning";
import {
  planningPresentationKey,
  readPlanningPresentation,
} from "../src/marketplaces/planning-presentation";
import {
  defaultSettings,
  type MarketplaceState,
} from "../src/marketplaces/storage";

const now = new Date("2026-10-25T12:00:00Z");
function fixture() {
  const w: WorkspaceDto = seedWorkspace();
  w.skus = w.skus.filter((s) => s.id === "sku-cats");
  w.tasks = [];
  w.boxes = [];
  w.shipments = [];
  const m: MarketplaceState = {
    connections: [
      {
        provider: "ozon",
        encrypted: "never expose this",
        clientId: "account-a",
        enabled: true,
        version: 2,
        lastSuccessVersion: 2,
        historyStoreId: "trusted-account-a",
        syncStatus: "success",
        lastAttemptAt: now.toISOString(),
        lastSuccessAt: now.toISOString(),
        message: null,
        warnings: [],
        runId: null,
      },
    ],
    snapshots: [
      {
        provider: "ozon",
        asOf: now.toISOString(),
        from: "2026-08-30",
        to: "2026-10-24",
        products: [{ externalId: "one", name: "Cats", barcodes: [] }],
        stocks: [
          {
            externalId: "one",
            warehouseId: "x",
            warehouseName: "x",
            availableUnits: 5,
            reservedUnits: 0,
            inboundUnits: 0,
          },
        ],
        demand: [
          {
            externalId: "one",
            date: "2026-10-23",
            orderedUnits: 100,
            cancelledUnits: 0,
            returnedUnits: 0,
            soldUnits: null,
          },
        ],
        coverage: { catalog: true, stocks: true, demand: true, inbound: true },
        warnings: [],
      },
    ],
    mappings: [
      {
        provider: "ozon",
        externalId: "one",
        skuId: "sku-cats",
        unitsPerItem: 1,
      },
    ],
    transit: {},
    settings: { ...defaultSettings, dispatchWeekday: 6 },
  };
  const forecast: ForecastPlanContext = {
    key: "history-a",
    goals: {},
    minimumBoxes: {},
    cacheCurrent: true,
  };
  const data = new Map<string, unknown>();
  let writes = 0;
  const tx: Queryable = {
    async query<T>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
      if (sql.startsWith("SELECT payload FROM forecast_results")) {
        const payload = data.get(params![0]);
        return { rows: payload ? [{ payload } as T] : [] };
      }
      assert.match(sql, /^INSERT INTO forecast_results/);
      writes++;
      data.set(params![0], JSON.parse(params![1]));
      return { rows: [] };
    },
  };
  const read = (clock = now, context = forecast) =>
    readPlanningPresentation(
      tx,
      w,
      m,
      clock,
      context,
      marketplacePlan(w, m, clock, context),
    );
  return { w, m, forecast, tx, data, read, writes: () => writes };
}

test("manager facts invalidate display and worker keys on change, cancellation and expiry", async () => {
  const { w, m, forecast } = fixture();
  const tx: Queryable = {
    async query<T>() {
      return { rows: [{ value: "revision" } as T] };
    },
  };
  const display = () => planningPresentationKey(w, m, forecast, now);
  const worker = () => forecastInputKey(tx, m, w.skus, [], now);
  const originalDisplay = display(),
    originalWorker = await worker();
  m.resolutions = [
    {
      id: "fact",
      kind: "zero_stock",
      provider: "ozon",
      storeId: "trusted-account-a",
      connectionVersion: 2,
      externalId: "one",
      skuId: "sku-cats",
      enabled: true,
      note: "Подтверждено",
      actorAccountId: "manager",
      revision: 1,
      confirmedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 1000).toISOString(),
    },
  ];
  assert.notEqual(display(), originalDisplay);
  assert.notEqual(await worker(), originalWorker);
  const enabledDisplay = display(),
    enabledWorker = await worker();
  m.resolutions[0].revision++;
  assert.notEqual(display(), enabledDisplay);
  assert.notEqual(await worker(), enabledWorker);
  const expired = new Date(now.getTime() + 1000);
  assert.equal(
    planningPresentationKey(w, m, forecast, expired),
    originalDisplay,
  );
  assert.equal(
    await forecastInputKey(tx, m, w.skus, [], expired),
    originalWorker,
  );
  m.resolutions[0].enabled = false;
  assert.equal(display(), originalDisplay);
  assert.equal(await worker(), originalWorker);
});

test("published plan survives automatic/manual running, failure, restart and Moscow day rollover", async () => {
  const { w, m, forecast, data, tx, read, writes } = fixture();
  const strict = marketplacePlan(w, m, now, forecast);
  assert.equal(strict.rows[0].dataComplete, true);
  assert.equal((await read()).planStatus.state, "current");
  assert.equal(writes(), 1);
  await read(new Date(now.getTime() + 60_000));
  assert.equal(
    writes(),
    1,
    "polling does not rewrite an unchanged result timestamp",
  );
  const saved = JSON.stringify(data.get("marketplace_plan_display"));
  for (const syncStatus of ["running", "failed", "partial"] as const) {
    m.connections[0].syncStatus = syncStatus;
    m.connections[0].syncMode = "manual";
    const later = new Date("2026-10-31T22:00:00Z");
    const result = await read(later);
    assert.ok(result.previousPlan);
    assert.equal(result.previousPlan.generatedAt, strict.generatedAt);
    assert.equal(result.previousPlan.dispatchDate, strict.dispatchDate);
    assert.equal(
      result.previousPlan.rows[0].recommendedBoxes,
      strict.rows[0].recommendedBoxes,
    );
    assert.equal(result.previousPlan.rows[0].canCreate, false);
    assert.equal(result.previousPlan.rows[0].backlogCanCreate, false);
    assert.equal(result.previousPlan.rows[0].advice.action, "none");
    assert.equal(
      marketplacePlan(w, m, later, forecast).rows[0].canCreate,
      false,
    );
  }
  // A fresh reader has no process-local state: only its DB payload is retained.
  data.set("marketplace_plan_display", JSON.parse(saved));
  const restarted = await readPlanningPresentation(
    tx,
    w,
    m,
    now,
    { ...forecast, cacheCurrent: false },
    marketplacePlan(w, m, now, forecast),
  );
  assert.equal(
    restarted.previousPlan!.rows[0].recommendedBoxes,
    strict.rows[0].recommendedBoxes,
  );
  assert.ok(
    !JSON.stringify(data.get("marketplace_plan_display")).includes(
      "never expose this",
    ),
  );
});

test("forecast replacement does not hide the prior plan or overwrite it with fallback", async () => {
  const { m, forecast, read, writes } = fixture();
  await read();
  const result = await read(now, {
    ...forecast,
    key: "history-b",
    cacheCurrent: false,
  });
  assert.ok(result.previousPlan);
  assert.equal(result.planStatus.state, "refreshing");
  assert.equal(writes(), 1);
  m.connections[0].syncStatus = "running";
  m.connections[0].syncMode = "automatic";
  const current = await read();
  assert.equal(current.previousPlan, null);
  assert.equal(current.planStatus.state, "refreshing");
});

test("bootstrap uses only full last-success snapshots, keeps missing late days unknown, and disables commands", async () => {
  const { w, m, forecast, read } = fixture();
  const before = structuredClone(m);
  m.connections[0].syncStatus = "failed";
  const result = await read(new Date("2026-10-26T12:00:00Z"));
  assert.ok(result.previousPlan);
  assert.equal(result.planStatus.salesThrough, "2026-10-24");
  assert.match(result.planStatus.message, /последним сохранённым/);
  assert.equal(result.previousPlan.rows[0].canCreate, false);
  assert.ok(result.previousPlan.rows[0].expectedSalesUnits30 > 0);
  assert.equal(m.snapshots[0].to, before.snapshots[0].to);
  assert.deepEqual(m.snapshots[0].demand, before.snapshots[0].demand);
  assert.equal(
    marketplacePlan(w, m, now, forecast).rows[0].dataComplete,
    false,
  );
});

test("compatibility ignores refresh details but invalidates account, mapping, packaging, settings, policies and planning enabled state", () => {
  const { w, m, forecast } = fixture();
  const original = planningPresentationKey(w, m, forecast);
  m.connections[0].syncStatus = "failed";
  m.connections[0].runId = "new-attempt";
  m.connections[0].lastAttemptAt = "2026-10-28T12:00:00Z";
  m.snapshots[0].asOf = "2026-10-28T12:00:00Z";
  assert.equal(
    planningPresentationKey(w, m, { ...forecast, key: "new-history-day" }),
    original,
  );
  m.settings.historyDays = 89;
  assert.equal(
    planningPresentationKey(w, m, forecast),
    original,
    "recent-window changes retain the previous dated display while ML retrains",
  );
  const cases: ((state: ReturnType<typeof fixture>) => void)[] = [
    ({ m }) => {
      m.connections[0].version++;
    },
    ({ m }) => {
      m.connections[0].historyStoreId = "other-account";
    },
    ({ m }) => {
      m.connections[0].enabled = false;
    },
    ({ m }) => {
      m.mappings[0].unitsPerItem = 2;
    },
    ({ w }) => {
      w.skus[0].unitsPerBox = 4;
    },
    ({ w }) => {
      w.skus[0].name = "different name";
    },
    ({ m }) => {
      m.settings.horizonDays++;
    },
    ({ forecast }) => {
      forecast.minimumBoxes["sku-cats"] = 2;
    },
    ({ forecast }) => {
      forecast.seasonalityEnabled = { "sku-cats": false };
    },
    ({ m }) => {
      m.planningStock = [
        { skuId: "sku-cats", enabled: false } as NonNullable<
          MarketplaceState["planningStock"]
        >[number],
      ];
    },
  ];
  for (const mutate of cases) {
    const state = fixture();
    mutate(state);
    assert.notEqual(
      planningPresentationKey(state.w, state.m, state.forecast),
      original,
    );
  }
});

test("missing primary data, unknown inbound, missing mapping, incomplete coverage, replaced credentials and old demand do not bootstrap zero plans", async () => {
  const cases: ((state: ReturnType<typeof fixture>) => void)[] = [
    ({ m }) => {
      m.snapshots = [];
    },
    ({ m }) => {
      m.snapshots[0].coverage.inbound = false;
      m.snapshots[0].stocks[0].inboundUnits = null;
    },
    ({ m }) => {
      m.snapshots[0].stocks[0].availableUnits = null;
    },
    ({ m }) => {
      m.mappings = [];
    },
    ({ m }) => {
      m.snapshots[0].coverage.demand = false;
    },
    ({ m }) => {
      m.snapshots[0].demand = [];
    },
    ({ m }) => {
      m.connections[0].version++;
    },
    ({ m }) => {
      delete m.connections[0].lastSuccessVersion;
    },
    ({ m }) => {
      m.snapshots[0].demand[0].date = "2026-08-30";
      m.snapshots[0].to = "2026-09-01";
    },
  ];
  for (const mutate of cases) {
    const state = fixture();
    state.m.connections[0].syncStatus = "failed";
    mutate(state);
    const result = await state.read(now, {
      ...state.forecast,
      cacheCurrent: false,
    });
    assert.equal(result.previousPlan, null);
    assert.equal(result.planStatus.state, "unavailable");
    assert.equal(state.writes(), 0);
  }
});

test("an incompatible saved plan cannot leak across a failed replacement connection", async () => {
  const { m, read } = fixture();
  await read();
  m.connections[0].version++;
  m.connections[0].historyStoreId = "new-account";
  m.connections[0].syncStatus = "failed";
  const result = await read();
  assert.equal(result.previousPlan, null);
  assert.equal(result.planStatus.state, "unavailable");
});

test("settings replacement waits for a matching forecast and never publishes a provisional zero as a saved plan", async () => {
  const { m, forecast, data, read, writes } = fixture();
  await read();
  const original = structuredClone(data.get("marketplace_plan_display"));
  m.settings.horizonDays = 28;
  m.settings.safetyDays = 0;
  m.settings.leadDays = 5;
  const pending = {
    ...forecast,
    key: "new-settings",
    cacheCurrent: false,
    goals: {},
  };
  const result = await read(now, pending);
  assert.equal(result.previousPlan, null);
  assert.equal(result.planStatus.state, "unavailable");
  assert.match(
    result.planStatus.message,
    /Пересчитываем план под текущие настройки/,
  );
  assert.equal(writes(), 1);
  assert.deepEqual(data.get("marketplace_plan_display"), original);
  const complete = await read(now, { ...pending, cacheCurrent: true });
  assert.equal(complete.planStatus.state, "current");
  assert.equal(complete.previousPlan, null);
  assert.equal(writes(), 2);
});

test("first pending forecast cannot seed a zero plan; a completed zero demand deficit remains legitimate", async () => {
  const { w, m, forecast, read, writes } = fixture();
  m.snapshots[0].stocks[0].availableUnits = 1_000_000;
  const pending = { ...forecast, cacheCurrent: false, goals: {} };
  const provisional = marketplacePlan(w, m, now, pending);
  assert.equal(provisional.rows[0].recommendedBoxes, 0);
  assert.equal(provisional.rows[0].advice.state, "covered");
  assert.equal((await read(now, pending)).planStatus.state, "unavailable");
  assert.equal(writes(), 0);
  const completed = await read(now, { ...pending, cacheCurrent: true });
  assert.equal(completed.planStatus.state, "current");
  assert.equal(completed.previousPlan, null);
  assert.equal(writes(), 1);
});

test("a cached plan with the retired stock estimates is ignored during forecast refresh", async () => {
  const { data, read, forecast } = fixture();
  await read();
  const key = "marketplace_plan_display";
  const cached = data.get(key) as {
    compatibilityKey: string;
    plan: ReturnType<typeof marketplacePlan>;
  };
  cached.compatibilityKey = "old-stock-model-key";
  cached.plan.rows[0].readyUnits = 300;
  const result = await read(now, { ...forecast, cacheCurrent: false });
  assert.equal(
    result.previousPlan?.rows.some((row) => row.readyUnits === 300) ?? false,
    false,
  );
});

test("a completed forecast with no mapped planning rows exposes the empty state without saving a zero plan", async () => {
  const { w, m, forecast, read, writes } = fixture();
  m.mappings = [];
  w.skus = [];
  const result = await read(now, forecast);
  assert.equal(result.previousPlan, null);
  assert.equal(result.planStatus.state, "current");
  assert.match(result.planStatus.message, /Свяжите товары/);
  assert.equal(writes(), 0);
});

test("saved review survives imports, worker replacement and restart while inbound remains unknown", async () => {
  const { w, m, forecast, tx, data, read, writes } = fixture();
  m.snapshots[0].inbound = [
    {
      externalId: "one",
      units: null,
      source: "ozon_analytics",
      supplyIds: [],
      warnings: [],
    },
  ];
  m.snapshots[0].stocks[0].inboundUnits = null;
  await read();
  const review = structuredClone(data.get("marketplace_plan_review_display"));
  assert.ok(review);
  assert.equal(data.has("marketplace_plan_display"), false);
  assert.equal(writes(), 1);
  await read(new Date(now.getTime() + 30_000));
  assert.equal(
    writes(),
    1,
    "unchanged review polling does not rewrite its timestamp",
  );
  for (const syncStatus of [
    "running",
    "failed",
    "partial",
    "success",
  ] as const) {
    m.connections[0].syncStatus = syncStatus;
    m.connections[0].syncMode = "automatic";
    const pending = { ...forecast, key: "replacement", cacheCurrent: false };
    const later = new Date(now.getTime() + 60_000);
    const result = await readPlanningPresentation(
      tx,
      w,
      m,
      later,
      pending,
      marketplacePlan(w, m, later, pending),
    );
    assert.equal(result.planStatus.state, "refreshing");
    assert.ok(result.previousPlan);
    assert.equal(result.previousPlan.generatedAt, now.toISOString());
    assert.equal(result.previousPlan.rows[0].dataComplete, false);
    assert.equal(result.previousPlan.rows[0].canCreate, false);
    assert.equal(result.previousPlan.rows[0].backlogCanCreate, false);
    assert.equal(result.previousPlan.rows[0].advice.state, "review");
  }
  assert.deepEqual(data.get("marketplace_plan_review_display"), review);
  assert.equal(writes(), 1);
  m.connections[0].version++;
  const replaced = await read(now, { ...forecast, cacheCurrent: false });
  assert.equal(replaced.previousPlan, null);
  assert.equal(
    replaced.planStatus.state,
    "unavailable",
    "review cannot cross accounts or versions",
  );
});

test("a published all-review plan remains visible after a failed or active import", async () => {
  for (const syncStatus of ["failed", "partial", "running"] as const) {
    const { w, m, forecast, read, data } = fixture();
    m.snapshots[0].inbound = [
      {
        externalId: "one",
        units: null,
        source: "ozon_analytics",
        supplyIds: [],
        warnings: [],
      },
    ];
    m.snapshots[0].stocks[0].inboundUnits = null;
    m.connections[0].syncStatus = syncStatus;
    m.connections[0].syncMode = "manual";
    const strict = marketplacePlan(w, m, now, forecast);
    assert.equal(strict.rows[0].dataComplete, false);
    assert.equal(strict.rows[0].canCreate, false);
    const result = await read();
    assert.equal(
      result.planStatus.state,
      syncStatus === "running" ? "refreshing" : "current",
    );
    assert.equal(result.previousPlan, null);
    assert.match(result.planStatus.message, /проверьте данные/);
    assert.equal(data.has("marketplace_plan_display"), false);
    assert.ok(data.get("marketplace_plan_review_display"));
  }
});
