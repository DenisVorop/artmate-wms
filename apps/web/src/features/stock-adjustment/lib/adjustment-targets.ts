import type {
  AdjustStockDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";

export type AdjustmentKind = AdjustStockDto["kind"];
type Source = Pick<
  WorkspaceDto,
  | "pallets"
  | "boxes"
  | "locations"
  | "sections"
  | "tasks"
  | "movements"
  | "putawayTasks"
  | "shipments"
  | "skus"
  | "lots"
>;
export type AdjustmentSnapshot = {
  kind: AdjustmentKind;
  targetId: string;
  code: string;
  skuName: string;
  skuCode: string;
  expectedLocationId: string;
  locationCode: string;
  expectedQuantity: number;
  units: number;
};
function activeLocation(data: Source, id: string | null): string | null {
  const location = data.locations.find((item) => item.id === id);
  if (!location) return "У объекта нет действующего адреса хранения";
  if (
    location.archived ||
    (location.sectionId &&
      !data.sections.some(
        (section) => section.id === location.sectionId && !section.archived,
      ))
  )
    return "Адрес находится в архиве";
  if (location.blocked) return "Адрес заблокирован";
  return null;
}
function movementReason(data: Source, palletId: string): string | null {
  return data.movements.some(
    (item) =>
      item.palletId === palletId &&
      ["planned", "in_transit"].includes(item.status),
  )
    ? "Паллета участвует в незавершённом перемещении"
    : null;
}
function putawayReason(
  data: Source,
  palletId: string,
  locationId: string | null,
  boxId?: string,
): string | null {
  return data.putawayTasks.some(
    (task) =>
      task.status !== "completed" &&
      ((boxId && task.boxId === boxId) ||
        task.fromPalletId === palletId ||
        (["claimed", "in_transit"].includes(task.status) &&
          task.toLocationId === locationId)),
  )
    ? "Объект или адрес удерживается заданием размещения коробов"
    : null;
}
/** Eligibility hints only; the API checks the frozen expectation and all reservations atomically. */
export function adjustmentTargetReason(
  data: Source,
  kind: AdjustmentKind,
  targetId: string,
): string | null {
  if (kind === "raw_count") {
    const pallet = data.pallets.find((item) => item.id === targetId);
    if (!pallet || pallet.kind !== "raw")
      return "Выберите паллету раскрасок до сборки";
    if (
      !pallet.lotId ||
      !data.lots.some((lot) => lot.id === pallet.lotId) ||
      !data.skus.some((sku) => sku.id === pallet.skuId)
    )
      return "У паллеты должна быть известна тематика и партия";
    if (pallet.status !== "stored" || !pallet.locationId)
      return "Паллета должна находиться на подтверждённом месте хранения";
    const problem =
      activeLocation(data, pallet.locationId) ||
      movementReason(data, pallet.id) ||
      putawayReason(data, pallet.id, pallet.locationId);
    if (problem) return problem;
    if (
      data.tasks.some(
        (task) =>
          task.status !== "completed" &&
          task.reservations.some(
            (reservation) =>
              reservation.palletId === pallet.id && reservation.quantity > 0,
          ),
      )
    )
      return "Паллета зарезервирована заданием сборки";
    return null;
  }
  const box = data.boxes.find((item) => item.id === targetId);
  if (!box || box.status !== "stored")
    return "Выберите целый короб на хранении";
  if (
    !Number.isInteger(box.units) ||
    box.units <= 0 ||
    box.lotContents.reduce((sum, item) => sum + item.quantity, 0) !== box.units
  )
    return "Состав короба не соответствует целому упакованному коробу";
  const pallet = data.pallets.find((item) => item.id === box.palletId);
  if (
    !pallet ||
    pallet.kind !== "finished" ||
    pallet.status !== "stored" ||
    !box.locationId ||
    pallet.locationId !== box.locationId
  )
    return "Короб должен стоять на тематической паллете хранения";
  if (
    data.locations.find((item) => item.id === box.locationId)?.kind ===
    "assembly"
  )
    return "Короб на накоплении сначала нужно разместить на хранение";
  const problem =
    activeLocation(data, box.locationId) ||
    movementReason(data, pallet.id) ||
    putawayReason(data, pallet.id, box.locationId, box.id);
  if (problem) return problem;
  if (
    data.shipments.some(
      (shipment) =>
        shipment.status === "draft" && shipment.boxIds.includes(box.id),
    )
  )
    return "Короб зарезервирован для отгрузки";
  return null;
}
export function captureAdjustmentSnapshot(
  data: Source,
  kind: AdjustmentKind,
  targetId: string,
): AdjustmentSnapshot | null {
  if (adjustmentTargetReason(data, kind, targetId)) return null;
  const target =
    kind === "raw_count"
      ? data.pallets.find((item) => item.id === targetId)
      : data.boxes.find((item) => item.id === targetId);
  if (!target?.locationId) return null;
  const sku = data.skus.find((item) => item.id === target.skuId),
    location = data.locations.find((item) => item.id === target.locationId)!;
  return {
    kind,
    targetId,
    code: target.code,
    skuName: sku?.name ?? "Тематика не найдена",
    skuCode: sku?.code ?? "—",
    expectedLocationId: target.locationId,
    locationCode: location.code,
    expectedQuantity:
      kind === "raw_count" ? ("quantity" in target ? target.quantity : 0) : 1,
    units: kind === "raw_count" ? 1 : "units" in target ? target.units : 0,
  };
}
export function eligibleAdjustmentTargets(
  data: Source,
  kind: AdjustmentKind,
): AdjustmentSnapshot[] {
  return (kind === "raw_count" ? data.pallets : data.boxes)
    .map((target) => captureAdjustmentSnapshot(data, kind, target.id))
    .filter((target): target is AdjustmentSnapshot => target !== null);
}
export function adjustmentSnapshotChanged(
  data: Source,
  snapshot: AdjustmentSnapshot,
): string | null {
  const target =
    snapshot.kind === "raw_count"
      ? data.pallets.find((item) => item.id === snapshot.targetId)
      : data.boxes.find((item) => item.id === snapshot.targetId);
  if (!target) return "Выбранный объект больше не найден на сервере";
  if (target.locationId !== snapshot.expectedLocationId)
    return "На сервере изменился адрес объекта. Исходный адрес в форме сохранён";
  if (
    snapshot.kind === "raw_count" &&
    "quantity" in target &&
    target.quantity !== snapshot.expectedQuantity
  )
    return `На сервере теперь ${target.quantity.toLocaleString("ru-RU")} шт.; в форме зафиксировано ${snapshot.expectedQuantity.toLocaleString("ru-RU")} шт.`;
  return adjustmentTargetReason(data, snapshot.kind, snapshot.targetId);
}
