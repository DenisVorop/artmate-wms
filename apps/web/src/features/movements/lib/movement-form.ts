import { z } from "zod";
import type {
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
export function toMovement(values: MovementValues): CreateMovementDto {
  return {
    ...values,
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
  data: WorkspaceDto,
  locationId: string,
  pallet?: PalletDto,
  kind?: string,
): string | null {
  const location = data.locations.find((item) => item.id === locationId);
  if (!location || !pallet) return null;
  if (pallet.kind === "assembly")
    return "разместите короба через второстепенные задания";
  if (
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
    data.movements.some(
      (item) =>
        ["planned", "in_transit"].includes(item.status) &&
        item.toLocationId === locationId,
    )
  )
    return "зарезервировано перемещением";
  if (
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
  data: Pick<WorkspaceDto, "putawayTasks">,
  pallet: Pick<PalletDto, "id" | "kind" | "locationId">,
): boolean {
  return (
    pallet.kind !== "assembly" &&
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
