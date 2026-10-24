"use client";
import { useSession } from "@/entities/session";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import type { PutawayScanValues } from "../lib/putaway-form";
export function usePutaway() {
  const commands = useWarehouseCommands();
  const { user } = useSession();
  const actorId = user?.employeeId ?? "";
  return {
    pending: commands.pending,
    error: commands.error,
    clearError: commands.clearError,
    claim: (id: string, _employeeId: string) =>
      commands.claimPutawayTask(id, {
        requestId: crypto.randomUUID(),
        employeeId: actorId,
      }),
    take: (id: string, _employeeId: string, values: PutawayScanValues) =>
      commands.takePutawayTask(id, {
        requestId: crypto.randomUUID(),
        employeeId: actorId,
        ...values,
      }),
    place: (id: string, _employeeId: string, values: PutawayScanValues) =>
      commands.placePutawayTask(id, {
        requestId: crypto.randomUUID(),
        employeeId: actorId,
        ...values,
      }),
    release: (id: string, _employeeId: string) =>
      commands.releasePutawayTask(id, {
        requestId: crypto.randomUUID(),
        employeeId: actorId,
      }),
  };
}
