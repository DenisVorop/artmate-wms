import type { WorkspaceDto, TaskDto } from "../dto";
import type {
  MarketplacePlanDto,
  MarketplacePlanRowDto,
} from "../marketplaces/dto";
import { planningBacklog } from "../marketplaces/planning-backlog";
import type { PlanningStockConfirmation } from "../marketplaces/planning-stock";
import type {
  AutomaticTaskIntent,
  AutomaticTaskOrigin,
  AutomaticTaskPurpose,
} from "./types";
export const ASSEMBLY_QUEUE_MAX_TASKS_PER_SKU = 5;
export const AUTOMATIC_QUEUE_MAX_TASKS = 5;
export const AUTOMATIC_RUN_MAX_INTENTS = 20;
export function untouchedAutomaticTask(
  task: TaskDto,
  origins: AutomaticTaskOrigin[],
) {
  return (
    origins.some(
      (origin) => origin.taskId === task.id && origin.status === "queued",
    ) &&
    task.status === "queued" &&
    task.employeeId === null &&
    task.boxesCompleted === 0 &&
    task.scannedUnits === 0 &&
    !task.boxCodeConfirmed &&
    task.sourcePalletId === null &&
    task.openBoxContents.length === 0
  );
}
export function automaticPlanningWorkspace(
  w: WorkspaceDto,
  origins: AutomaticTaskOrigin[],
): WorkspaceDto {
  return {
    ...w,
    tasks: w.tasks.filter((task) => !untouchedAutomaticTask(task, origins)),
  };
}
function placeholderTask(skuId: string, boxesTarget: number): TaskDto {
  return {
    id: `automatic-capacity:${skuId}`,
    code: "",
    createdAt: null,
    skuId,
    boxesTarget,
    boxesCompleted: 0,
    unitsPerBox: 1,
    status: "queued",
    employeeId: null,
    scannedUnits: 0,
    sourcePalletId: null,
    openBoxCode: "",
    boxCodeConfirmed: false,
    reservations: [],
    openBoxContents: [],
  };
}
/** Reuse the same physical reservation guards as one-box backlog planning. */
function storageFits(
  w: WorkspaceDto,
  row: MarketplacePlanRowDto,
  confirmations: PlanningStockConfirmation[],
) {
  const probe = {
    ...row,
    recommendedBoxes: 0,
    recommendedUnits: 0,
    backlogCanCreate: false,
    backlogBoxes: 0,
  };
  planningBacklog(w, [probe], { [row.skuId]: 1 }, confirmations);
  return probe.backlogCapacityKnown && probe.backlogCanCreate;
}
function urgentBoxAllowed(row: MarketplacePlanRowDto) {
  if (row.canCreate) return true;
  // These two whole-recommendation constraints are satisfied by a bounded batch.
  // Every other blocker remains authoritative, including newly introduced ones.
  const batchOnlyBlockers = new Set<string>();
  if (row.recommendedUnits > row.rawAvailableUnits)
    batchOnlyBlockers.add(
      "Недостаточно свободных размещённых раскрасок для всей рекомендации",
    );
  if (row.recommendedBoxes > 1000)
    batchOnlyBlockers.add(
      "Рекомендация превышает предел одного задания: 1000 коробов",
    );
  return (
    row.blockers.length > 0 &&
    row.blockers.every((blocker) => batchOnlyBlockers.has(blocker))
  );
}
export function automaticTaskIntents(
  w: WorkspaceDto,
  plan: MarketplacePlanDto,
  origins: AutomaticTaskOrigin[],
  assemblyBlocked: boolean,
  confirmations: PlanningStockConfirmation[] = [],
): AutomaticTaskIntent[] {
  const untouched = w.tasks.filter((task) =>
    untouchedAutomaticTask(task, origins),
  );
  const base = automaticPlanningWorkspace(w, origins);
  // Taken, assigned and manual work keeps its slot until completion. Only
  // untouched automatic work may be replaced by the latest priorities.
  const availableSlots = Math.max(
    0,
    AUTOMATIC_QUEUE_MAX_TASKS -
      base.tasks.filter((task) => task.status !== "completed").length,
  );
  // Rotate only themes that have actually entered work. Pending automatic
  // proposals do not change ordering on each scheduler tick.
  const lastServedAt = new Map<string, number>();
  for (const task of base.tasks) {
    const origin = origins.find(
      (item) => item.taskId === task.id && item.status === "queued",
    );
    if (!origin) continue;
    const timestamp = Date.parse(
      task.startedAt ?? origin.createdAt ?? task.createdAt ?? "",
    );
    const knownTime = Number.isFinite(timestamp)
      ? timestamp
      : Number.NEGATIVE_INFINITY;
    lastServedAt.set(
      task.skuId,
      Math.max(
        lastServedAt.get(task.skuId) ?? Number.NEGATIVE_INFINITY,
        knownTime,
      ),
    );
  }
  const simulation = { ...base, tasks: [...base.tasks] };
  const desired = new Map<
    string,
    { count: number; purpose: AutomaticTaskPurpose; hash: string }
  >();
  const unlocated = plan.rows.some(
    (row) => row.unregisteredUnits > 0 || row.stockEstimated,
  );
  if (!assemblyBlocked && !unlocated) {
    const ranked = [...plan.rows].sort(
      (a, b) =>
        Number(lastServedAt.has(a.skuId)) - Number(lastServedAt.has(b.skuId)) ||
        (lastServedAt.get(a.skuId) ?? Number.NEGATIVE_INFINITY) -
          (lastServedAt.get(b.skuId) ?? Number.NEGATIVE_INFINITY) ||
        (b.dispatchShortageUnits ?? 0) - (a.dispatchShortageUnits ?? 0) ||
        (a.backlogRank ?? Number.MAX_SAFE_INTEGER) -
          (b.backlogRank ?? Number.MAX_SAFE_INTEGER) ||
        a.skuName.localeCompare(b.skuName, "ru") ||
        a.skuId.localeCompare(b.skuId),
    );
    const rows = [...new Map(ranked.map((row) => [row.skuId, row])).values()];
    let remainingSlots = availableSlots;
    for (const purpose of ["urgent", "backlog"] as const) {
      // One turn per theme before the next round within the same priority.
      for (
        let round = 0;
        round < ASSEMBLY_QUEUE_MAX_TASKS_PER_SKU && remainingSlots;
        round++
      ) {
        for (const row of rows) {
          if (!remainingSlots) break;
          const urgent = row.recommendedBoxes > 0;
          if (urgent !== (purpose === "urgent")) continue;
          const sku = w.skus.find((item) => item.id === row.skuId);
          if (
            !sku ||
            !row.dataComplete ||
            !row.backlogCapacityKnown ||
            !Number.isSafeInteger(sku.unitsPerBox) ||
            sku.unitsPerBox < 1 ||
            (urgent ? !urgentBoxAllowed(row) : !row.backlogCanCreate)
          )
            continue;
          const existing = base.tasks.filter(
            (task) => task.skuId === sku.id && task.status !== "completed",
          ).length;
          const alreadyPlanned = desired.get(sku.id)?.count ?? 0;
          const limit = Math.min(
            ASSEMBLY_QUEUE_MAX_TASKS_PER_SKU - existing,
            Math.floor(row.rawAvailableUnits / sku.unitsPerBox),
            urgent ? row.recommendedBoxes : Math.max(0, 1 - existing),
          );
          if (
            alreadyPlanned >= limit ||
            !storageFits(simulation, row, confirmations)
          )
            continue;
          desired.set(sku.id, {
            count: alreadyPlanned + 1,
            purpose,
            hash: row.proposalHash,
          });
          simulation.tasks.push(placeholderTask(sku.id, 1));
          remainingSlots--;
        }
      }
    }
  }
  const intents: AutomaticTaskIntent[] = [];
  const retained = new Map<string, number>();
  for (const task of untouched) {
    const goal = desired.get(task.skuId);
    const kept = retained.get(task.skuId) ?? 0;
    if (!goal || kept >= goal.count) {
      intents.push({
        kind: "withdraw",
        taskId: task.id,
        reason: assemblyBlocked
          ? "Сначала освободите место сборки."
          : "План изменился: это задание больше не нужно.",
      });
    } else {
      retained.set(task.skuId, kept + 1);
      const origin = origins.find((item) => item.taskId === task.id)!;
      if (task.boxesTarget !== 1 || origin.purpose !== goal.purpose)
        intents.push({
          kind: "resize",
          taskId: task.id,
          boxesTarget: 1,
          purpose: goal.purpose,
          proposalHash: goal.hash,
        });
    }
    // A truncated reconciliation must finish withdrawing obsolete work in a
    // later run before creating replacements; otherwise the live queue can grow.
    if (intents.length >= AUTOMATIC_RUN_MAX_INTENTS) return intents;
  }
  for (const [skuId, goal] of desired) {
    for (let count = retained.get(skuId) ?? 0; count < goal.count; count++) {
      intents.push({
        kind: "create",
        skuId,
        boxesTarget: 1,
        purpose: goal.purpose,
        proposalHash: goal.hash,
      });
      if (intents.length >= AUTOMATIC_RUN_MAX_INTENTS) return intents;
    }
  }
  return intents;
}
