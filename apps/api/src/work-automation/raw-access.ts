import type * as D from "../dto";
import { placementError } from "../physical";
import { levelCostMeters } from "../placement-ranking";
import { placementRoutes } from "../placement-routing";

export type AutomaticMovementIntent =
  | { kind: "create"; palletId: string; toLocationId: string }
  | { kind: "cancel"; movementId: string; reason: string };
export interface RawAccessOptions {
  blockedLocationIds?: ReadonlySet<string>;
  /** Current need order, if available; physical accessibility needs no forecast. */
  demandSkuIds?: string[];
}
type AccessMovement = D.MovementDto & { autoPurpose?: string };
const unfinished = (movement: D.MovementDto) =>
  ["planned", "in_transit"].includes(movement.status);
const rawStock = (pallet: D.PalletDto) =>
  pallet.kind === "raw" &&
  Number.isSafeInteger(pallet.quantity) &&
  pallet.quantity > 0 &&
  ["stored", "in_transit"].includes(pallet.status);
function activeLocation(w: D.WorkspaceDto, id: string | null) {
  return w.locations.find(
    (location) =>
      location.id === id &&
      !location.archived &&
      !location.blocked &&
      (!location.sectionId ||
        w.sections.some(
          (section) => section.id === location.sectionId && !section.archived,
        )),
  );
}
function lowLocation(location: D.LocationDto | undefined) {
  return (
    !!location &&
    (location.kind === "floor" ||
      (location.kind === "rack" && [1, 2].includes(location.level)))
  );
}
function lotTime(w: D.WorkspaceDto, pallet: D.PalletDto) {
  const lot = w.lots.find(
    (item) => item.id === pallet.lotId && item.skuId === pallet.skuId,
  );
  const value = Date.parse(lot?.receivedAt ?? "");
  return Number.isFinite(value) ? value : null;
}
function lowCoverage(
  w: D.WorkspaceDto,
  skuId: string,
  latestReceivedAt = Infinity,
) {
  return w.pallets.some((pallet) => {
    if (!rawStock(pallet) || pallet.skuId !== skuId) return false;
    const time = lotTime(w, pallet);
    if (time === null || time > latestReceivedAt) return false;
    if (
      pallet.status === "stored" &&
      lowLocation(activeLocation(w, pallet.locationId)) &&
      !w.movements.some(
        (movement) => movement.palletId === pallet.id && unfinished(movement),
      )
    )
      return true;
    // A committed incoming pallet already provides the future picking face.
    return w.movements.some(
      (movement) =>
        movement.palletId === pallet.id &&
        unfinished(movement) &&
        lowLocation(activeLocation(w, movement.toLocationId)),
    );
  });
}
function sourceProblem(w: D.WorkspaceDto, pallet: D.PalletDto | undefined) {
  if (
    !pallet ||
    !rawStock(pallet) ||
    pallet.status !== "stored" ||
    !pallet.skuId ||
    !w.skus.some((sku) => sku.id === pallet.skuId)
  )
    return "Нужна непустая паллета сырья на хранении";
  const source = activeLocation(w, pallet.locationId);
  if (
    !source ||
    source.kind !== "rack" ||
    !Number.isSafeInteger(source.level) ||
    source.level < 3
  )
    return "Спуск доступен только с третьего яруса и выше";
  if (
    ![pallet.widthMm, pallet.depthMm, pallet.heightMm].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return "Уточните размеры паллеты";
  if (pallet.returnLocationId)
    return "Сначала завершите возврат паллеты на сохранённый адрес";
  if (
    w.tasks.some(
      (task) =>
        task.status !== "completed" &&
        (task.skuId === pallet.skuId ||
          task.reservations.some(
            (reservation) =>
              reservation.palletId === pallet.id && reservation.quantity > 0,
          )),
    )
  )
    return "Тематика уже участвует в незавершённой сборке";
  if (
    w.movements.some(
      (movement) =>
        unfinished(movement) &&
        (movement.palletId === pallet.id ||
          movement.fromLocationId === source.id ||
          movement.toLocationId === source.id),
    ) ||
    w.putawayTasks.some(
      (task) =>
        task.status !== "completed" &&
        (task.fromLocationId === source.id || task.toLocationId === source.id),
    ) ||
    w.pallets.some(
      (other) =>
        other.id !== pallet.id &&
        other.status !== "retired" &&
        other.returnLocationId === source.id,
    ) ||
    w.addressHolds?.some((hold) => hold.locationId === source.id)
  )
    return "Исходный адрес занят другой складской операцией";
  const stock = w.pallets.filter(
    (other) => rawStock(other) && other.skuId === pallet.skuId,
  );
  const times = stock.map((other) => lotTime(w, other));
  if (times.some((time) => time === null))
    return "Для FIFO нужны даты всех партий этой тематики";
  const oldest = Math.min(...(times as number[]));
  if (lotTime(w, pallet) !== oldest)
    return "Сначала нужна самая старая партия этой тематики";
  if (lowCoverage(w, pallet.skuId, oldest))
    return "Самая старая партия этой тематики уже доступна внизу";
  return null;
}
function targetProblem(
  w: D.WorkspaceDto,
  pallet: D.PalletDto,
  targetId: string,
) {
  const target = activeLocation(w, targetId);
  if (!target || target.kind !== "rack" || ![1, 2].includes(target.level))
    return "Для спуска нужен доступный адрес первого или второго яруса";
  if (
    w.addressHolds?.some((hold) => hold.locationId === target.id) ||
    w.movements.some(
      (movement) =>
        unfinished(movement) && movement.fromLocationId === target.id,
    ) ||
    w.putawayTasks.some(
      (task) =>
        task.status !== "completed" && task.fromLocationId === target.id,
    ) ||
    w.boxes.some(
      (box) => box.status === "stored" && box.locationId === target.id,
    )
  )
    return "Нижний адрес занят другой складской операцией";
  return placementError(w, target, pallet, pallet.id);
}
/** Reused at create/claim time under the warehouse lock, not a scan shortcut. */
export function rawAccessMovementProblem(
  state: D.WorkspaceDto,
  palletId: string,
  toLocationId: string,
  ignoreMovementId?: string,
): string | null {
  const w = ignoreMovementId
    ? {
        ...state,
        movements: state.movements.filter(
          (movement) => movement.id !== ignoreMovementId,
        ),
      }
    : state;
  const pallet = w.pallets.find((item) => item.id === palletId);
  const sourceError = sourceProblem(w, pallet);
  if (sourceError) return sourceError;
  const targetError = targetProblem(w, pallet!, toLocationId);
  if (targetError) return targetError;
  const route = placementRoutes(w, pallet!.locationId, [toLocationId]).get(
    toLocationId,
  );
  return route &&
    ["aisles", "floor"].includes(route.status) &&
    route.distanceMeters !== null
    ? null
    : "По схеме не подтверждён доступный маршрут спуска";
}
function untouchedMovement(movement: AccessMovement) {
  return (
    movement.autoPurpose === "accessible_raw" &&
    movement.status === "planned" &&
    movement.employeeId === null &&
    movement.takenAt === null &&
    movement.completedAt === null
  );
}

/** One physical replenishment at a time; each cycle rechecks a newly free face. */
export function rawAccessMovementIntents(
  state: D.WorkspaceDto,
  options: RawAccessOptions = {},
): AutomaticMovementIntent[] {
  const editable = (state.movements as AccessMovement[])
    .filter(untouchedMovement)
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  const w = {
    ...state,
    movements: state.movements.filter(
      (movement) => !editable.some((item) => item.id === movement.id),
    ),
  };
  const blocked = options.blockedLocationIds ?? new Set<string>();
  const protectedMove = (w.movements as AccessMovement[]).some(
    (movement) =>
      movement.autoPurpose === "accessible_raw" && unfinished(movement),
  );
  const intents: AutomaticMovementIntent[] = [];
  let retained = false;
  for (const movement of editable) {
    const problem = protectedMove
      ? "Сначала завершите уже взятый спуск паллеты"
      : w.pallets.find((pallet) => pallet.id === movement.palletId)
            ?.locationId !== movement.fromLocationId
        ? "Паллета больше не находится на исходном адресе"
        : blocked.has(movement.fromLocationId) ||
            blocked.has(movement.toLocationId)
          ? "Адрес участвует в инвентаризации"
          : rawAccessMovementProblem(
              w,
              movement.palletId,
              movement.toLocationId,
            );
    if (!problem && !retained) {
      retained = true;
      continue;
    }
    intents.push({
      kind: "cancel",
      movementId: movement.id,
      reason: problem ?? "Свободное задание спуска уже существует",
    });
  }
  if (retained || protectedMove) return intents;
  const demand = new Map(
    (options.demandSkuIds ?? []).map((skuId, index) => [skuId, index]),
  );
  const candidates: {
    pallet: D.PalletDto;
    target: D.LocationDto;
    duplicateTheme: boolean;
    demand: number;
    score: number;
  }[] = [];
  for (const pallet of w.pallets) {
    if (
      sourceProblem(w, pallet) ||
      !pallet.locationId ||
      blocked.has(pallet.locationId)
    )
      continue;
    const targets = w.locations.filter(
      (target) =>
        !blocked.has(target.id) && !targetProblem(w, pallet, target.id),
    );
    if (!targets.length) continue;
    const routes = placementRoutes(
      w,
      pallet.locationId,
      targets.map((target) => target.id),
    );
    for (const target of targets) {
      const route = routes.get(target.id);
      if (
        !route ||
        !["aisles", "floor"].includes(route.status) ||
        route.distanceMeters === null
      )
        continue;
      candidates.push({
        pallet,
        target,
        duplicateTheme: lowCoverage(w, pallet.skuId!),
        demand: demand.get(pallet.skuId!) ?? Number.MAX_SAFE_INTEGER,
        score: route.distanceMeters + levelCostMeters(target),
      });
    }
  }
  candidates.sort(
    (a, b) =>
      Number(a.duplicateTheme) - Number(b.duplicateTheme) ||
      a.demand - b.demand ||
      a.score - b.score ||
      a.pallet.skuId!.localeCompare(b.pallet.skuId!) ||
      a.pallet.id.localeCompare(b.pallet.id) ||
      a.target.code.localeCompare(b.target.code) ||
      a.target.id.localeCompare(b.target.id),
  );
  if (candidates[0])
    intents.push({
      kind: "create",
      palletId: candidates[0].pallet.id,
      toLocationId: candidates[0].target.id,
    });
  return intents;
}
