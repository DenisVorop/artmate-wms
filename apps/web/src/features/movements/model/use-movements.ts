"use client";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import {
  toMovement,
  type MovementValues,
  type ScanValues,
} from "../lib/movement-form";
export function useMovements() {
  const commands = useWarehouseCommands();
  return {
    pending: commands.pending,
    error: commands.error,
    clearError: commands.clearError,
    create: (values: MovementValues) =>
      commands.createMovement(toMovement(values)),
    take: (id: string, values: ScanValues) =>
      commands.takeMovement(id, { ...values, requestId: crypto.randomUUID() }),
    place: (id: string, values: ScanValues) =>
      commands.placeMovement(id, { ...values, requestId: crypto.randomUUID() }),
    cancel: (id: string) =>
      commands.cancelMovement(id, { requestId: crypto.randomUUID() }),
    retire: (id: string, values: ScanValues) =>
      commands.retireEmptyPallet(id, {
        ...values,
        requestId: crypto.randomUUID(),
      }),
  };
}
