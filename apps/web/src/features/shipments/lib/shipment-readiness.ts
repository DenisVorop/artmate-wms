import type {
  PalletDto,
  BoxDto,
  ShipmentDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";

export function shipmentReadiness(data: WorkspaceDto, shipment: ShipmentDto) {
  const boxes = shipment.boxIds.map((id) =>
    data.boxes.find((box) => box.id === id),
  );
  const ready =
    boxes.length === shipment.boxesRequested &&
    boxes.every((box) => {
      if (!box || !isShipmentBoxAvailable(data, box, shipment.id)) return false;
      const location = data.locations.find(
        (item) => item.id === box.locationId,
      );
      const pallet = data.pallets.find((item) => item.id === box.palletId);
      return (
        !!location &&
        !location.blocked &&
        !location.archived &&
        ["picking", "shipping"].includes(location.kind) &&
        !!pallet &&
        pallet.status === "stored" &&
        pallet.locationId === box.locationId &&
        !data.movements.some(
          (movement) =>
            movement.palletId === pallet.id &&
            ["planned", "in_transit"].includes(movement.status),
        )
      );
    });
  const pallets = data.pallets.filter((pallet) =>
    boxes.some((box) => box?.palletId === pallet.id),
  );
  return { ready, boxes, pallets };
}

// Availability is a preview. The API validates the reservation when saving.
export function pickingHint(
  data: WorkspaceDto,
  locationId: string,
  pallet?: PalletDto,
): string | null {
  const location = data.locations.find((item) => item.id === locationId);
  if (!location) return "адрес не найден";
  if (
    pallet &&
    data.putawayTasks.some(
      (task) =>
        ["claimed", "in_transit"].includes(task.status) &&
        task.toLocationId === pallet.locationId,
    )
  )
    return "паллету назначения удерживает размещение коробов";
  if (pallet?.kind === "assembly")
    return "разместите короба с накопителя по тематикам";
  if (
    data.putawayTasks.some(
      (task) =>
        ["claimed", "in_transit"].includes(task.status) &&
        task.toLocationId === locationId,
    )
  )
    return "резерв размещения коробов";
  if (location.archived) return "адрес удалён с плана";
  if (location.blocked) return "адрес закрыт";
  if (
    data.pallets.some(
      (item) => item.status === "stored" && item.locationId === locationId,
    )
  )
    return "занято";
  if (
    data.movements.some(
      (item) =>
        ["planned", "in_transit"].includes(item.status) &&
        item.toLocationId === locationId,
    )
  )
    return "цель зарезервирована";
  if (data.pallets.some((item) => item.returnLocationId === locationId))
    return "резерв возврата";
  if (!pallet) return null;
  if (pallet.quantity > location.maxBoxes)
    return "не помещается по количеству коробов";
  if (pallet.heightMm > location.maxHeightMm) return "недостаточно высоты";
  const fits =
    (pallet.widthMm <= location.availableWidthMm &&
      pallet.depthMm <= location.availableDepthMm) ||
    (pallet.depthMm <= location.availableWidthMm &&
      pallet.widthMm <= location.availableDepthMm);
  if (!fits) return "не подходит по габаритам";
  if (location.maxWeightKg !== null && pallet.weightKg === null)
    return "не указана масса паллеты";
  if (
    location.maxWeightKg !== null &&
    pallet.weightKg !== null &&
    pallet.weightKg > location.maxWeightKg
  )
    return "превышена масса";
  return null;
}

/** Reservation preview only: the server rechecks this at command time. */
export function isShipmentBoxAvailable(
  data: Pick<
    WorkspaceDto,
    | "locations"
    | "sections"
    | "pallets"
    | "putawayTasks"
    | "shipments"
    | "movements"
  >,
  box: BoxDto,
  currentShipmentId?: string,
): boolean {
  if (box.status !== "stored" || !box.palletId || !box.locationId) return false;
  const location = data.locations.find((item) => item.id === box.locationId);
  const pallet = data.pallets.find((item) => item.id === box.palletId);
  if (
    !location ||
    location.archived ||
    location.blocked ||
    location.kind === "assembly"
  )
    return false;
  if (
    location.sectionId &&
    !data.sections.some(
      (section) => section.id === location.sectionId && !section.archived,
    )
  )
    return false;
  if (
    !pallet ||
    pallet.kind !== "finished" ||
    pallet.skuId !== box.skuId ||
    pallet.status !== "stored" ||
    pallet.locationId !== box.locationId
  )
    return false;
  if (
    data.movements.some(
      (movement) =>
        movement.palletId === pallet.id &&
        ["planned", "in_transit"].includes(movement.status),
    )
  )
    return false;
  if (
    data.putawayTasks.some(
      (task) => task.boxId === box.id && task.status !== "completed",
    )
  )
    return false;
  if (
    data.shipments.some(
      (shipment) =>
        shipment.id !== currentShipmentId &&
        shipment.status === "draft" &&
        shipment.boxIds.includes(box.id),
    )
  )
    return false;
  return true;
}
