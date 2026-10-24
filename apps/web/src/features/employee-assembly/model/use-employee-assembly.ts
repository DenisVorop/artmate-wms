"use client";
import { useRef, useState } from "react";
import { useSession } from "@/entities/session";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import type {
  TaskDto,
  ScanTaskDtoKind,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import { employeeAssemblyResult } from "../lib/employee-assembly";

export function useEmployeeAssembly() {
  const { user } = useSession();
  const commands = useWarehouseCommands();
  const busy = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const employeeId = user?.employeeId ?? "";
  const run = async (task: TaskDto, command: () => Promise<WorkspaceDto>) => {
    if (
      busy.current ||
      !employeeId ||
      (task.employeeId !== null && task.employeeId !== employeeId)
    )
      return false;
    busy.current = true;
    try {
      const result = await command();
      setNotice(employeeAssemblyResult(task, result.tasks, employeeId));
      return true;
    } catch {
      return false;
    } finally {
      busy.current = false;
    }
  };
  const actor = () => ({ requestId: crypto.randomUUID(), employeeId });
  return {
    pending: commands.pending,
    error: commands.error,
    notice,
    claim: (task: TaskDto) =>
      run(task, () => commands.claimTask(task.id, actor())),
    pause: (task: TaskDto) =>
      run(task, () =>
        commands.updateTaskStatus(task.id, { ...actor(), status: "paused" }),
      ),
    scan: (task: TaskDto, kind: ScanTaskDtoKind, value: string) =>
      run(task, () => commands.scanTask(task.id, { ...actor(), kind, value })),
    recover: (task: TaskDto, boxCode: string) =>
      run(task, () => commands.packTask(task.id, { ...actor(), boxCode })),
  };
}
