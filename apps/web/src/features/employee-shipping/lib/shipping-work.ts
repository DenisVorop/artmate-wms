import type {
  ShipmentDto,
  WorkspaceDto,
  WorkZoneDto,
} from "@/shared/api/generated/model";

export function employeeShippingWork(
  data: Pick<WorkspaceDto, "warehouse" | "shipments">,
  employeeId: string,
) {
  const assignment = employeeId
    ? data.warehouse.zoneWork.find((work) => work.employeeId === employeeId)
    : undefined;
  const zone = data.warehouse.workZones.find(
    (zone) => zone.id === assignment?.zoneId,
  );
  const shipment =
    assignment?.jobKind === "shipping"
      ? data.shipments.find(
          (shipment) =>
            shipment.id === assignment.jobId &&
            shipment.employeeId === employeeId &&
            shipment.workZoneId === zone?.id,
        )
      : undefined;
  return { assignment, zone, shipment };
}

export function employeeShippingProgress(shipment: ShipmentDto) {
  const reserved = new Set(shipment.boxIds);
  const scanned = new Set(
    (shipment.scannedBoxIds ?? []).filter((id) => reserved.has(id)),
  );
  return {
    scanned: scanned.size,
    total: shipment.boxIds.length,
    nextBoxId: shipment.boxIds.find((id) => !scanned.has(id)),
    complete:
      shipment.boxIds.length > 0 &&
      reserved.size === shipment.boxIds.length &&
      shipment.boxIds.length === shipment.boxesRequested &&
      scanned.size === reserved.size,
  };
}

export function employeeShippingScopeIssue(
  data: Pick<WorkspaceDto, "boxes" | "pallets" | "locations" | "movements">,
  shipment: ShipmentDto,
  zone: WorkZoneDto,
): string | null {
  if (
    shipment.boxIds.length !== shipment.boxesRequested ||
    new Set(shipment.boxIds).size !== shipment.boxIds.length
  )
    return "Состав отгрузки изменился. Обновите данные или сообщите руководителю.";
  for (const id of shipment.boxIds) {
    const box = data.boxes.find((box) => box.id === id);
    const location = data.locations.find(
      (location) => location.id === box?.locationId,
    );
    const pallet = data.pallets.find((pallet) => pallet.id === box?.palletId);
    if (
      !box ||
      box.status !== "stored" ||
      !location ||
      location.archived ||
      location.blocked ||
      !zone.locationIds.includes(location.id) ||
      !["picking", "shipping"].includes(location.kind) ||
      !pallet ||
      pallet.status !== "stored" ||
      pallet.locationId !== box.locationId
    )
      return "Один из коробов больше недоступен на адресе этой зоны. Сообщите руководителю.";
    if (
      data.movements.some(
        (movement) =>
          movement.palletId === pallet.id &&
          ["planned", "in_transit"].includes(movement.status),
      )
    )
      return "Паллета отгрузки перемещается. Дождитесь подтверждённого размещения.";
  }
  return null;
}
