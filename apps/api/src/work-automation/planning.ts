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
export const AUTOMATIC_TASK_MAX_BOXES = 10;
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
  boxes: number,
  confirmations: PlanningStockConfirmation[],
) {
  const probe = structuredClone(row);
  Object.assign(probe, {
    recommendedBoxes: 0,
    recommendedUnits: 0,
    backlogCanCreate: false,
    backlogBoxes: 0,
  });
  const workspace =
    boxes > 1
      ? { ...w, tasks: [...w.tasks, placeholderTask(row.skuId, boxes - 1)] }
      : w;
  planningBacklog(workspace, [probe], { [row.skuId]: boxes }, confirmations);
  return probe.backlogCapacityKnown && probe.backlogCanCreate;
}
function urgentBatchAllowed(row: MarketplacePlanRowDto) {
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
  const simulation = { ...base, tasks: [...base.tasks] };
  const desired = new Map<
    string,
    { boxes: number; purpose: AutomaticTaskPurpose; hash: string }
  >();
  const unlocated = plan.rows.some(
    (row) => row.unregisteredUnits > 0 || row.stockEstimated,
  );
  if (!assemblyBlocked && !unlocated) {
    const rows = [...plan.rows].sort(
      (a, b) =>
        Number(b.recommendedBoxes > 0) - Number(a.recommendedBoxes > 0) ||
        (a.backlogRank ?? Number.MAX_SAFE_INTEGER) -
          (b.backlogRank ?? Number.MAX_SAFE_INTEGER) ||
        a.skuName.localeCompare(b.skuName, "ru"),
    );
    for (const row of rows) {
      if (desired.size >= AUTOMATIC_RUN_MAX_INTENTS) break;
      const sku = w.skus.find((item) => item.id === row.skuId);
      if (
        !sku ||
        !row.dataComplete ||
        !row.backlogCapacityKnown ||
        !Number.isSafeInteger(sku.unitsPerBox) ||
        sku.unitsPerBox < 1 ||
        base.tasks.some(
          (task) => task.skuId === sku.id && task.status !== "completed",
        )
      )
        continue;
      const purpose = row.recommendedBoxes > 0 ? "urgent" : "backlog";
      if (
        purpose === "urgent" ? !urgentBatchAllowed(row) : !row.backlogCanCreate
      )
        continue;
      const rawBoxes = Math.floor(row.rawAvailableUnits / sku.unitsPerBox);
      let boxes = Math.min(
        AUTOMATIC_TASK_MAX_BOXES,
        rawBoxes,
        purpose === "urgent" ? row.recommendedBoxes : 1,
      );
      while (boxes > 0 && !storageFits(simulation, row, boxes, confirmations))
        boxes--;
      if (!Number.isSafeInteger(boxes) || boxes < 1) continue;
      desired.set(sku.id, { boxes, purpose, hash: row.proposalHash });
      simulation.tasks.push(placeholderTask(sku.id, boxes));
    }
  }
  const intents: AutomaticTaskIntent[] = [];
  const retained = new Set<string>();
  for (const task of untouched) {
    const goal = desired.get(task.skuId);
    if (!goal || retained.has(task.skuId)) {
      intents.push({
        kind: "withdraw",
        taskId: task.id,
        reason: assemblyBlocked
          ? "Сначала освободите место сборки."
          : "План изменился: это задание больше не нужно.",
      });
    } else {
      retained.add(task.skuId);
      const origin = origins.find((item) => item.taskId === task.id)!;
      if (task.boxesTarget !== goal.boxes || origin.purpose !== goal.purpose)
        intents.push({
          kind: "resize",
          taskId: task.id,
          boxesTarget: goal.boxes,
          purpose: goal.purpose,
          proposalHash: goal.hash,
        });
    }
    if (intents.length >= AUTOMATIC_RUN_MAX_INTENTS) return intents;
  }
  for (const [skuId, goal] of desired) {
    if (retained.has(skuId)) continue;
    intents.push({
      kind: "create",
      skuId,
      boxesTarget: goal.boxes,
      purpose: goal.purpose,
      proposalHash: goal.hash,
    });
    if (intents.length >= AUTOMATIC_RUN_MAX_INTENTS) break;
  }
  return intents;
}
