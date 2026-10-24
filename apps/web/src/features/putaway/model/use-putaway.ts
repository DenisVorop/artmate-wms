"use client";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import type { PutawayScanValues } from "../lib/putaway-form";
export function usePutaway() {
  const commands = useWarehouseCommands();
  return {
    pending: commands.pending,
    error: commands.error,
    clearError: commands.clearError,
    claim: (id: string, employeeId: string) =>
      commands.claimPutawayTask(id, {
        requestId: crypto.randomUUID(),
        employeeId,
      }),
    take: (id: string, employeeId: string, values: PutawayScanValues) =>
      commands.takePutawayTask(id, {
        requestId: crypto.randomUUID(),
        employeeId,
        ...values,
      }),
    place: (id: string, employeeId: string, values: PutawayScanValues) =>
      commands.placePutawayTask(id, {
        requestId: crypto.randomUUID(),
        employeeId,
        ...values,
      }),
    release: (id: string, employeeId: string) =>
      commands.releasePutawayTask(id, {
        requestId: crypto.randomUUID(),
        employeeId,
      }),
  };
}
