"use client";
import { useSession } from "@/entities/session";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import type { ScanTaskDtoKind } from "@/shared/api/generated/model";
import {
  buildAssembly,
  buildAssignment,
  type AssemblyValues,
  type AssignmentValues,
} from "../lib/assembly-form";
export function useAssembly() {
  const commands = useWarehouseCommands();
  const { user } = useSession();
  const actorId = user?.employeeId ?? "";
  return {
    pending: commands.pending,
    error: commands.error,
    clearError: commands.clearError,
    create: (values: AssemblyValues) =>
      commands.createTask(buildAssembly(values)),
    claim: (id: string, _employeeId: string) =>
      commands.claimTask(id, {
        requestId: crypto.randomUUID(),
        employeeId: actorId,
      }),
    assign: (id: string, values: AssignmentValues) =>
      commands.assignTask(id, buildAssignment(values)),
    scan: (
      id: string,
      _employeeId: string,
      kind: ScanTaskDtoKind,
      value: string,
    ) =>
      commands.scanTask(id, {
        requestId: crypto.randomUUID(),
        employeeId: actorId,
        kind,
        value,
      }),
    recover: (id: string, _employeeId: string, boxCode: string) =>
      commands.packTask(id, {
        requestId: crypto.randomUUID(),
        employeeId: actorId,
        boxCode,
      }),
    pause: (id: string, _employeeId: string) =>
      commands.updateTaskStatus(id, {
        requestId: crypto.randomUUID(),
        employeeId: actorId,
        status: "paused",
      }),
  };
}
