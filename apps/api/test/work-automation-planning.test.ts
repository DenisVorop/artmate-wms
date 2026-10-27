import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedWorkspace } from "../src/seed";
import { migrateAddressesAndMovements } from "../src/migrations";
import type { TaskDto, WorkspaceDto } from "../src/dto";
import type {
  MarketplacePlanDto,
  MarketplacePlanRowDto,
} from "../src/marketplaces/dto";
import {
  automaticTaskIntents,
  automaticPlanningWorkspace,
  untouchedAutomaticTask,
} from "../src/work-automation/planning";
import type { AutomaticTaskOrigin } from "../src/work-automation/types";
const time = "2026-10-27T10:00:00Z";
function fixture() {
  const w: WorkspaceDto = migrateAddressesAndMovements(seedWorkspace());
  w.tasks = [];
  w.boxes = [];
  w.putawayTasks = [];
  w.shipments = [];
  w.pallets = w.pallets.filter((p) => p.kind === "raw");
  const row = (skuId = "sku-cats", recommendedBoxes = 3) =>
    ({
      skuId,
      skuName: skuId,
      unitsPerBox: 20,
      averageDailyUnits: 10,
      localAfterAssemblyUnits: 0,
      dataComplete: true,
      canCreate: true,
      recommendedBoxes,
      recommendedUnits: recommendedBoxes * 20,
      rawAvailableUnits: 1000,
      unregisteredUnits: 0,
      stockEstimated: false,
      backlogCapacityKnown: true,
      backlogCanCreate: recommendedBoxes === 0,
      backlogBoxes: recommendedBoxes === 0 ? 1 : 0,
      backlogRank: 1,
      proposalHash: "approved-plan",
      providers: [],
    }) as unknown as MarketplacePlanRowDto;
  const task = (id: string, skuId = "sku-cats", boxesTarget = 3): TaskDto => ({
    id,
    code: id,
    skuId,
    boxesTarget,
    boxesCompleted: 0,
    unitsPerBox: 20,
    employeeId: null,
    status: "queued",
    scannedUnits: 0,
    sourcePalletId: null,
    openBoxCode: `${id}-box`,
    openBoxContents: [],
    boxCodeConfirmed: false,
    reservations: [],
    createdAt: time,
  });
  const origin = (id: string, skuId = "sku-cats"): AutomaticTaskOrigin => ({
    taskId: id,
    skuId,
    purpose: "urgent",
    proposalHash: "old-plan",
    createdAt: time,
    updatedAt: time,
    boxesTarget: 3,
    status: "queued",
    withdrawnAt: null,
    withdrawnReason: null,
    withdrawnTask: null,
  });
  const plan = (...rows: MarketplacePlanRowDto[]) =>
    ({ rows }) as MarketplacePlanDto;
  return { w, row, task, origin, plan };
}
test("automatic work uses small urgent batches first and one backlog box without mutating input", () => {
  const { w, row, plan } = fixture();
  const before = JSON.stringify(w);
  const intents = automaticTaskIntents(
    w,
    plan(row("sku-cats", 30), row("sku-space", 0)),
    [],
    false,
  );
  assert.deepEqual(
    intents.map((i) =>
      i.kind === "create" ? [i.skuId, i.boxesTarget, i.purpose] : [],
    ),
    [
      ["sku-cats", 10, "urgent"],
      ["sku-space", 1, "backlog"],
    ],
  );
  assert.equal(JSON.stringify(w), before);
});
test("a feasible small urgent batch may cover part of the recommendation, but never ignores another blocker", () => {
  const { w, row, plan } = fixture();
  const r = row("sku-cats", 30);
  r.rawAvailableUnits = 45;
  r.canCreate = false;
  r.blockers = [
    "Недостаточно свободных размещённых раскрасок для всей рекомендации",
  ];
  const allowed = automaticTaskIntents(w, plan(r), [], false);
  assert.equal(allowed[0].kind === "create" ? allowed[0].boxesTarget : 0, 2);
  r.blockers.push("Нужно подтвердить остатки");
  assert.deepEqual(automaticTaskIntents(w, plan(r), [], false), []);
});
test("unknown, unregistered, missing raw, full storage or assembly pressure never creates work", () => {
  for (const mode of [
    "unknown",
    "unregistered",
    "raw",
    "storage",
    "assembly",
    "packaging",
  ] as const) {
    const { w, row, plan } = fixture();
    const r = row();
    if (mode === "unknown") r.dataComplete = false;
    if (mode === "unregistered") r.unregisteredUnits = 1;
    if (mode === "raw") r.rawAvailableUnits = 0;
    if (mode === "storage")
      w.locations.forEach((l) => {
        if (["rack", "floor"].includes(l.kind)) l.blocked = true;
      });
    if (mode === "packaging") w.skus[0].packaging = null as never;
    assert.deepEqual(
      automaticTaskIntents(w, plan(r), [], mode === "assembly"),
      [],
      mode,
    );
  }
});
test("existing human or taken work prevents duplicate work for that SKU", () => {
  for (const status of ["queued", "active", "paused"]) {
    const { w, row, task, plan } = fixture();
    const human = task("manual");
    human.status = status;
    w.tasks.push(human);
    assert.deepEqual(automaticTaskIntents(w, plan(row()), [], false), []);
  }
});
test("only untouched unassigned automated queues are excluded from calculation", () => {
  const { w, task, origin } = fixture();
  const auto = task("auto");
  const origins = [origin("auto")];
  w.tasks = [auto, task("manual")];
  assert.equal(untouchedAutomaticTask(auto, origins), true);
  assert.deepEqual(
    automaticPlanningWorkspace(w, origins).tasks.map((t) => t.id),
    ["manual"],
  );
  for (const patch of [
    { status: "active" },
    { status: "paused" },
    { employeeId: "employee-1" },
    { scannedUnits: 1 },
    { boxesCompleted: 1 },
    { boxCodeConfirmed: true },
    { sourcePalletId: "raw" },
    { openBoxContents: [{ lotId: "lot", quantity: 1 }] },
  ]) {
    assert.equal(untouchedAutomaticTask({ ...auto, ...patch }, origins), false);
  }
});
test("reconciliation keeps IDs, reduces changed targets, withdraws obsolete or duplicate untouched tasks", () => {
  const { w, row, task, origin, plan } = fixture();
  w.tasks = [task("auto"), task("duplicate"), task("obsolete", "sku-space")];
  const origins = [
    origin("auto"),
    origin("duplicate"),
    origin("obsolete", "sku-space"),
  ];
  const intents = automaticTaskIntents(
    w,
    plan(row("sku-cats", 2)),
    origins,
    false,
  );
  assert.deepEqual(
    intents.map((i) =>
      i.kind === "resize"
        ? [i.kind, i.taskId, i.boxesTarget]
        : i.kind === "withdraw"
          ? [i.kind, i.taskId]
          : [i.kind],
    ),
    [
      ["resize", "auto", 2],
      ["withdraw", "duplicate"],
      ["withdraw", "obsolete"],
    ],
  );
  assert.deepEqual(
    automaticTaskIntents(w, plan(row()), origins, false).map((i) => i.kind),
    ["withdraw", "withdraw"],
  );
});
test("full assembly withdraws only untouched queued auto work and preserves started work", () => {
  const { w, row, task, origin, plan } = fixture();
  const active = task("active");
  active.status = "active";
  active.employeeId = "employee-1";
  w.tasks = [task("auto"), active, task("manual")];
  const intents = automaticTaskIntents(
    w,
    plan(row()),
    [origin("auto"), origin("active")],
    true,
  );
  assert.deepEqual(
    intents.map((i) => ("taskId" in i ? i.taskId : "")),
    ["auto"],
  );
});
test("different thematic queues share one real free storage slot instead of overbooking it", () => {
  const { w, row, plan } = fixture();
  const rawLocations = new Set(w.pallets.map((p) => p.locationId));
  const free = w.locations.find(
    (location) =>
      ["rack", "floor"].includes(location.kind) &&
      !rawLocations.has(location.id),
  )!;
  for (const location of w.locations)
    if (
      ["rack", "floor"].includes(location.kind) &&
      !rawLocations.has(location.id)
    )
      location.blocked = location.id !== free.id;
  free.maxBoxes = 1;
  const intents = automaticTaskIntents(
    w,
    plan(row("sku-cats", 0), row("sku-space", 0)),
    [],
    false,
  );
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, "create");
});
test("optional batches reserve physical storage across SKUs and never exceed twenty mutations", () => {
  const { w, row, task, origin, plan } = fixture();
  const rawLocations = new Set(w.pallets.map((p) => p.locationId));
  w.locations.forEach((l) => {
    if (["rack", "floor"].includes(l.kind) && !rawLocations.has(l.id))
      l.blocked = true;
  });
  assert.deepEqual(
    automaticTaskIntents(
      w,
      plan(row("sku-cats", 0), row("sku-space", 0)),
      [],
      false,
    ),
    [],
  );
  w.tasks = Array.from({ length: 25 }, (_, i) => task(`auto-${i}`));
  const origins = w.tasks.map((t) => origin(t.id));
  assert.equal(automaticTaskIntents(w, plan(), origins, true).length, 20);
});
