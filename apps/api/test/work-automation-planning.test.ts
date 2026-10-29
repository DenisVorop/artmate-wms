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
  AUTOMATIC_QUEUE_MAX_TASKS,
  AUTOMATIC_RUN_MAX_INTENTS,
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

function wideFixture(count = 100) {
  const f = fixture();
  const template = f.w.skus[0];
  f.w.skus = Array.from({ length: count }, (_, index) => ({
    ...template,
    id: `sku-${String(index).padStart(3, "0")}`,
  }));
  const rows = f.w.skus.map((sku, index) => ({
    ...f.row(sku.id, 1),
    backlogRank: index + 1,
  }));
  return { ...f, rows };
}
test("one hundred eligible themes create only five tasks in the existing urgent/backlog priority order", () => {
  const { w, rows, plan } = wideFixture();
  rows[0].recommendedBoxes = 0;
  rows[0].backlogCanCreate = true;
  const intents = automaticTaskIntents(w, plan(...rows.reverse()), [], false);
  assert.equal(intents.length, AUTOMATIC_QUEUE_MAX_TASKS);
  assert.deepEqual(
    intents.map((intent) => intent.kind === "create" && intent.skuId),
    ["sku-001", "sku-002", "sku-003", "sku-004", "sku-005"],
  );
});
test("claiming a task keeps its queue slot; completion allows one fresh highest-priority theme", () => {
  const { w, rows, task, origin, plan } = wideFixture(8);
  w.tasks = rows
    .slice(0, 5)
    .map((row, index) => task(`auto-${index}`, row.skuId, 1));
  const origins = w.tasks.map((task) => ({
    ...origin(task.id, task.skuId),
    boxesTarget: 1,
  }));
  w.tasks[0].status = "active";
  w.tasks[0].employeeId = "employee-1";
  assert.deepEqual(automaticTaskIntents(w, plan(...rows), origins, false), []);
  w.tasks[0].status = "completed";
  w.tasks[0].boxesCompleted = 1;
  rows[0].recommendedBoxes = 0;
  rows[0].backlogCanCreate = false;
  rows[7].backlogRank = 0;
  const intents = automaticTaskIntents(w, plan(...rows), origins, false);
  assert.deepEqual(
    intents.map((intent) => intent.kind === "create" && intent.skuId),
    ["sku-007"],
  );
});
test("manual, assigned, paused and partially completed work occupy slots and are never reconciled", () => {
  const { w, rows, task, origin, plan } = wideFixture(8);
  w.tasks = [
    task("manual", rows[0].skuId, 1),
    { ...task("assigned", rows[1].skuId, 1), employeeId: "employee-1" },
    { ...task("paused", rows[2].skuId, 1), status: "paused" },
    { ...task("partial", rows[3].skuId, 2), boxesCompleted: 1 },
    { ...task("active", rows[4].skuId, 1), status: "active" },
    task("obsolete", rows[5].skuId, 1),
  ];
  const origins = w.tasks
    .filter((task) => task.id !== "manual")
    .map((task) => origin(task.id, task.skuId));
  const before = structuredClone(w.tasks);
  assert.deepEqual(automaticTaskIntents(w, plan(...rows), origins, false), [
    {
      kind: "withdraw",
      taskId: "obsolete",
      reason: "План изменился: это задание больше не нужно.",
    },
  ]);
  assert.deepEqual(w.tasks, before);
  w.tasks.pop();
  w.tasks.push(task("extra-manual", rows[5].skuId, 1));
  assert.deepEqual(automaticTaskIntents(w, plan(...rows), origins, false), []);
});
test("an oversized legacy queue withdraws safely in bounded runs before any replacements are created", () => {
  const { w, rows, task, origin, plan } = wideFixture(40);
  w.tasks = rows
    .slice(0, 30)
    .map((row, index) => task(`legacy-${index}`, row.skuId, 1));
  const origins = w.tasks.map((task) => origin(task.id, task.skuId));
  const nextPlan = plan(...rows.slice(30));
  const first = automaticTaskIntents(w, nextPlan, origins, false);
  assert.equal(first.length, AUTOMATIC_RUN_MAX_INTENTS);
  assert.ok(first.every((intent) => intent.kind === "withdraw"));
  w.tasks = w.tasks.filter(
    (task) =>
      !first.some((intent) => "taskId" in intent && intent.taskId === task.id),
  );
  const second = automaticTaskIntents(w, nextPlan, origins, false);
  assert.equal(
    second.filter((intent) => intent.kind === "withdraw").length,
    10,
  );
  assert.equal(second.filter((intent) => intent.kind === "create").length, 5);
  let live = w.tasks.length;
  for (const intent of second) {
    if (intent.kind === "withdraw") live--;
    if (intent.kind === "create") {
      live++;
      assert.ok(live <= AUTOMATIC_QUEUE_MAX_TASKS);
    }
  }
  assert.equal(live, AUTOMATIC_QUEUE_MAX_TASKS);
});
test("duplicate plan rows cannot spend queue capacity twice for the same theme", () => {
  const { w, rows, plan } = wideFixture(8);
  const intents = automaticTaskIntents(
    w,
    plan(rows[0], rows[0], ...rows.slice(1)),
    [],
    false,
  );
  assert.equal(intents.length, AUTOMATIC_QUEUE_MAX_TASKS);
  assert.equal(
    new Set(intents.map((intent) => intent.kind === "create" && intent.skuId))
      .size,
    AUTOMATIC_QUEUE_MAX_TASKS,
  );
});

test("a hundred-box demand rotates to another urgent theme after a batch and returns in a later round", () => {
  const { w, rows, task, origin, plan } = wideFixture(6);
  rows[0].recommendedBoxes = 100;
  rows[0].recommendedUnits = 2000;
  w.tasks = rows
    .slice(0, 5)
    .map((row, index) =>
      task(`auto-${index}`, row.skuId, index === 0 ? 10 : 1),
    );
  const origins = w.tasks.map((task) => ({
    ...origin(task.id, task.skuId),
    boxesTarget: task.boxesTarget,
  }));
  w.tasks[0].status = "completed";
  w.tasks[0].boxesCompleted = 10;
  const next = automaticTaskIntents(w, plan(...rows), origins, false);
  assert.deepEqual(
    next.map((intent) => intent.kind === "create" && intent.skuId),
    ["sku-005"],
  );
  w.tasks.push(task("auto-5", rows[5].skuId, 1));
  origins.push(origin("auto-5", rows[5].skuId));
  assert.deepEqual(automaticTaskIntents(w, plan(...rows), origins, false), []);
  // Every alternative theme has now had a real batch. Oldest served goes first.
  w.tasks.forEach((task, index) => {
    task.status = "completed";
    task.boxesCompleted = task.boxesTarget;
    origins[index].createdAt =
      `2026-10-27T${String(10 + index).padStart(2, "0")}:00:00Z`;
  });
  const round = automaticTaskIntents(w, plan(...rows), origins, false);
  assert.equal(round[0].kind === "create" && round[0].skuId, "sku-000");
  assert.equal(round[0].kind === "create" && round[0].boxesTarget, 10);
});
test("a single needed theme may continue in ten-box batches when no valid alternative needs work", () => {
  const { w, rows, task, origin, plan } = wideFixture(2);
  rows[0].recommendedBoxes = 100;
  rows[0].recommendedUnits = 2000;
  rows[1].dataComplete = false;
  const done = task("done", rows[0].skuId, 10);
  done.status = "completed";
  done.boxesCompleted = 10;
  w.tasks.push(done);
  const intents = automaticTaskIntents(
    w,
    plan(...rows),
    [origin(done.id, done.skuId)],
    false,
  );
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind === "create" && intents[0].skuId, rows[0].skuId);
  assert.equal(intents[0].kind === "create" && intents[0].boxesTarget, 10);
});
test("rotation preserves urgent priority over backlog and handles unknown legacy times deterministically", () => {
  const { w, rows, task, origin, plan } = wideFixture(3);
  w.tasks = rows.slice(0, 2).map((row, index) => ({
    ...task(`done-${index}`, row.skuId, 1),
    status: "completed",
    boxesCompleted: 1,
    createdAt: null,
  }));
  const origins = w.tasks.map((task) => ({
    ...origin(task.id, task.skuId),
    createdAt: "unknown-legacy-time",
  }));
  rows[2].recommendedBoxes = 0;
  rows[2].backlogCanCreate = true;
  const first = automaticTaskIntents(
    w,
    plan(...rows.reverse()),
    origins,
    false,
  );
  assert.deepEqual(
    first.map((intent) => intent.kind === "create" && intent.skuId),
    ["sku-000", "sku-001", "sku-002"],
  );
  assert.deepEqual(
    automaticTaskIntents(w, plan(...rows), origins, false),
    first,
  );
});
