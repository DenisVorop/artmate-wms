import type { ShipmentDto } from "@/shared/api/generated/model";

export type ShipmentFilter = "active" | "ready" | "shipped" | "all";

export function shipmentStatus(shipment: ShipmentDto, ready: boolean) {
  if (shipment.status === "shipped") return "Отправлена";
  if (ready) return "Готова к отправке";
  if (shipment.scannedBoxIds?.length) return "Отбор начат";
  return "Короба зарезервированы";
}
