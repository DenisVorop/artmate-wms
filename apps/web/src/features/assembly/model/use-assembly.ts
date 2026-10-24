"use client";
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
  return {
    pending: commands.pending,
    error: commands.error,
    clearError: commands.clearError,
    create: (values: AssemblyValues) =>
      commands.createTask(buildAssembly(values)),
    claim: (id: string, employeeId: string) =>
      commands.claimTask(id, { requestId: crypto.randomUUID(), employeeId }),
    assign: (id: string, values: AssignmentValues) =>
      commands.assignTask(id, buildAssignment(values)),
    scan: (
      id: string,
      employeeId: string,
      kind: ScanTaskDtoKind,
      value: string,
    ) =>
      commands.scanTask(id, {
        requestId: crypto.randomUUID(),
        employeeId,
        kind,
        value,
      }),
    recover: (id: string, employeeId: string, boxCode: string) =>
      commands.packTask(id, {
        requestId: crypto.randomUUID(),
        employeeId,
        boxCode,
      }),
    pause: (id: string, employeeId: string) =>
      commands.updateTaskStatus(id, {
        requestId: crypto.randomUUID(),
        employeeId,
        status: "paused",
      }),
  };
}
