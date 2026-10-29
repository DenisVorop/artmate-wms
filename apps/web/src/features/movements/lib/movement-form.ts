import { z } from "zod";
import type {
  AuthUserDto,
  MovementDto,
  CreateMovementDto,
  PalletDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";

export const movementSchema = z.object({
  palletId: z.string().min(1, "Выберите паллету"),
  toLocationId: z.string().min(1, "Выберите целевой адрес"),
  kind: z.enum(["transfer", "lower", "return"]),
  employeeId: z.string().min(1, "Назначьте сотрудника на смене"),
  keepSourceReserved: z.boolean(),
});
export type MovementValues = z.infer<typeof movementSchema>;
export const movementDefaults: MovementValues = {
  palletId: "",
  toLocationId: "",
  kind: "transfer",
  employeeId: "",
  keepSourceReserved: false,
};
export const scanSchema = z.object({
  palletCode: z.string().trim().min(1, "Введите или отсканируйте код паллеты"),
  locationCode: z.string().trim().min(1, "Введите или отсканируйте QR адреса"),
});
export type ScanValues = z.infer<typeof scanSchema>;
export const movementKinds: Record<string, string> = {
  transfer: "Перемещение",
  lower: "Спуск для отбора",
  return: "Возврат остатка",
};
export const movementStatuses: Record<string, string> = {
  planned: "Ожидает забора",
  in_transit: "В пути",
  completed: "Завершено",
  cancelled: "Отменено",
};
export function toMovement(
  values: MovementValues,
  user?: Pick<AuthUserDto, "employeeId" | "role"> | null,
): CreateMovementDto {
  return {
    ...values,
    ...(user?.role === "employee" ? { employeeId: user.employeeId } : {}),
    requestId: crypto.randomUUID(),
    keepSourceReserved: values.kind === "lower" && values.keepSourceReserved,
  };
}

export function canReturn(data: WorkspaceDto, pallet: PalletDto): boolean {
  return (
    !!pallet.returnLocationId ||
    data.locations.some(
      (location) =>
        !location.archived &&
        location.id === pallet.locationId &&
        ["picking", "shipping"].includes(location.kind),
    )
  );
}

// Hints only. The API rechecks every condition transactionally at command time.
export function targetHint(
  data: Pick<
    WorkspaceDto,
    "locations" | "pallets" | "movements" | "putawayTasks" | "addressHolds"
  >,
  locationId: string,
  pallet?: PalletDto,
  kind?: string,
): string | null {
  const location = data.locations.find((item) => item.id === locationId);
  if (!location || !pallet) return null;
  if (pallet.kind === "assembly")
    return "разместите короба через второстепенные задания";
  if (
    data.addressHolds?.some(
      (hold) => hold.kind === "putaway" && hold.locationId === locationId,
    ) ||
    data.putawayTasks.some(
      (task) =>
        ["claimed", "in_transit"].includes(task.status) &&
        task.toLocationId === locationId,
    )
  )
    return "зарезервировано размещением коробов";
  if (kind === "transfer" && pallet.returnLocationId === locationId)
    return "для удерживаемого адреса выберите возврат";
  if (location.archived) return "адрес удалён с плана";
  if (location.blocked) return "адрес закрыт";
  if (location.id === pallet.locationId) return "исходный адрес";
  if (
    kind === "lower" &&
    (location.kind !== "picking" || location.accessSides !== 4)
  )
    return "нужна зона отбора с доступом с четырёх сторон";
  if (
    data.pallets.some(
      (item) =>
        item.id !== pallet.id &&
        item.status === "stored" &&
        item.locationId === locationId,
    )
  )
    return "занято паллетой";
  if (
    data.addressHolds?.some(
      (hold) => hold.kind === "movement" && hold.locationId === locationId,
    ) ||
    data.movements.some(
      (item) =>
        ["planned", "in_transit"].includes(item.status) &&
        item.toLocationId === locationId,
    )
  )
    return "зарезервировано перемещением";
  if (
    (pallet.returnLocationId !== locationId &&
      data.addressHolds?.some(
        (hold) => hold.kind === "return" && hold.locationId === locationId,
      )) ||
    data.pallets.some(
      (item) => item.id !== pallet.id && item.returnLocationId === locationId,
    )
  )
    return "удерживается для возврата";
  const fits =
    (pallet.widthMm <= location.availableWidthMm &&
      pallet.depthMm <= location.availableDepthMm) ||
    (pallet.depthMm <= location.availableWidthMm &&
      pallet.widthMm <= location.availableDepthMm);
  if (!fits) return "не подходит по ширине и глубине";
  if (pallet.kind === "finished" && pallet.quantity > location.maxBoxes)
    return "не помещается по количеству коробов";
  if (pallet.heightMm > location.maxHeightMm) return "недостаточно высоты";
  if (location.maxWeightKg !== null && pallet.weightKg === null)
    return "для адреса требуется масса паллеты";
  if (
    location.maxWeightKg !== null &&
    pallet.weightKg !== null &&
    pallet.weightKg > location.maxWeightKg
  )
    return "превышена допустимая масса";
  return null;
}

export function movementTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

export function wholePalletMovementAllowed(
  data: Pick<WorkspaceDto, "putawayTasks" | "addressHolds">,
  pallet: Pick<PalletDto, "id" | "kind" | "locationId">,
): boolean {
  return (
    pallet.kind !== "assembly" &&
    !data.addressHolds?.some(
      (hold) =>
        hold.kind === "putaway" && hold.locationId === pallet.locationId,
    ) &&
    !data.putawayTasks.some(
      (task) => task.fromPalletId === pallet.id && task.status !== "completed",
    ) &&
    !data.putawayTasks.some(
      (task) =>
        ["claimed", "in_transit"].includes(task.status) &&
        task.toLocationId === pallet.locationId,
    )
  );
}
export function movementPalletName(
  data: Pick<WorkspaceDto, "skus">,
  pallet?: Pick<PalletDto, "kind" | "skuId">,
): string {
  return pallet?.kind === "assembly"
    ? "Общая паллета сборки"
    : (data.skus.find((sku) => sku.id === pallet?.skuId)?.name ?? "Паллета");
}

export function movementTitle(
  movement: Pick<MovementDto, "kind" | "autoPurpose">,
) {
  return movement.autoPurpose === "accessible_raw"
    ? "Спустить сырьё ниже"
    : movementKinds[movement.kind];
}

/** UI hint only; claim is validated again on the server. */
export function movementClaimHint(
  data: Pick<
    WorkspaceDto,
    "employees" | "tasks" | "putawayTasks" | "movements" | "shipments"
  >,
  employeeId: string | undefined,
  movementId: string,
): string | null {
  if (
    !employeeId ||
    !data.employees.some(
      (item) => item.id === employeeId && item.status === "working",
    )
  )
    return "Начните смену, чтобы взять задание.";
  if (
    data.movements.some(
      (item) =>
        item.id !== movementId &&
        item.employeeId === employeeId &&
        ["planned", "in_transit"].includes(item.status),
    )
  )
    return "Сначала завершите своё перемещение.";
  if (
    data.putawayTasks.some(
      (item) =>
        item.employeeId === employeeId &&
        ["claimed", "in_transit"].includes(item.status),
    )
  )
    return "Сначала завершите размещение короба.";
  if (
    data.tasks.some(
      (item) =>
        item.employeeId === employeeId &&
        item.status !== "completed" &&
        (item.scannedUnits > 0 ||
          item.boxCodeConfirmed ||
          item.openBoxContents?.length > 0),
    )
  )
    return "Сначала завершите открытый короб.";
  if (
    data.shipments.some(
      (item) =>
        item.employeeId === employeeId &&
        item.status === "draft" &&
        (item.scannedBoxIds?.length ?? 0) > 0,
    )
  )
    return "Сначала завершите текущий отбор отгрузки.";
  if (
    data.tasks.some(
      (item) => item.employeeId === employeeId && item.status === "active",
    )
  )
    return "Сначала поставьте сборку на паузу.";
  return null;
}
