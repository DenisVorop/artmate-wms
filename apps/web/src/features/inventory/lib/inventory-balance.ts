import {
  BoxDtoStatus,
  PalletDtoKind,
  PalletDtoStatus,
} from "@/shared/api/generated/model";
import type { BoxDto, PalletDto, TaskDto } from "@/shared/api/generated/model";

type InventorySource = {
  pallets: Pick<PalletDto, "id" | "skuId" | "kind" | "status" | "quantity">[];
  boxes: Pick<BoxDto, "skuId" | "status" | "units">[];
  tasks: Pick<TaskDto, "skuId" | "scannedUnits" | "reservations">[];
};
export function isAccountedPallet(pallet: Pick<PalletDto, "status">): boolean {
  return (
    pallet.status === PalletDtoStatus.stored ||
    pallet.status === PalletDtoStatus.in_transit
  );
}
export function isVisibleInventoryPallet(
  pallet: Pick<PalletDto, "status">,
): boolean {
  return isAccountedPallet(pallet) || pallet.status === PalletDtoStatus.retired;
}
export function isAccountedBox(box: Pick<BoxDto, "status">): boolean {
  return (
    box.status === BoxDtoStatus.stored ||
    box.status === BoxDtoStatus.in_transit ||
    box.status === BoxDtoStatus.staged
  );
}
/** Per-SKU projection; the global balance comes directly from WorkspaceDto.balance. */
export function skuInventory(data: InventorySource, skuId: string) {
  const rawPallets = data.pallets.filter(
    (pallet) =>
      pallet.skuId === skuId &&
      pallet.kind === PalletDtoKind.raw &&
      isAccountedPallet(pallet),
  );
  const rawIds = new Set(rawPallets.map((pallet) => pallet.id));
  const rawUnits = rawPallets.reduce((sum, pallet) => sum + pallet.quantity, 0);
  const workInProgressUnits = data.tasks
    .filter((task) => task.skuId === skuId)
    .reduce((sum, task) => sum + task.scannedUnits, 0);
  const boxes = data.boxes.filter(
    (box) => box.skuId === skuId && isAccountedBox(box),
  );
  const boxedUnits = boxes.reduce((sum, box) => sum + box.units, 0);
  const reservedUnits = data.tasks
    .flatMap((task) => task.reservations)
    .filter((reservation) => rawIds.has(reservation.palletId))
    .reduce((sum, reservation) => sum + reservation.quantity, 0);
  return {
    rawUnits,
    workInProgressUnits,
    boxedUnits,
    totalUnits: rawUnits + workInProgressUnits + boxedUnits,
    boxesCount: boxes.length,
    reservedUnits,
  };
}
