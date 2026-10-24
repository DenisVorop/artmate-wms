"use client";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import {
  buildPreparation,
  buildShipment,
  type PreparationValues,
  type ShipmentValues,
} from "../lib/shipment-form";
export function useShipments() {
  const c = useWarehouseCommands();
  return {
    ...c,
    prepare: (values: PreparationValues) =>
      c.createMovement(buildPreparation(values)),
    create: (v: ShipmentValues) => c.createShipment(buildShipment(v)),
    ship: (id: string) =>
      c.shipShipment(id, { requestId: crypto.randomUUID() }),
  };
}
