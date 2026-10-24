"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/entities/session";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import { getAuthEpoch } from "@/shared/api/auth-memory";
import { employeeMode, type EmployeeMode } from "../lib/workday";
export function useEmployeeWorkday(initialMode?: string) {
  const { user } = useSession(),
    commands = useWarehouseCommands();
  const shiftBusy = useRef(false);
  const [mode, setMode] = useState<EmployeeMode>(employeeMode(initialMode));
  useEffect(() => setMode(employeeMode(initialMode)), [initialMode]);
  return {
    mode,
    choose: setMode,
    pending: commands.pending,
    error: commands.error,
    clearError: commands.clearError,
    setShift: async (status: "working" | "break" | "off") => {
      if (!user || commands.pending || shiftBusy.current) return false;
      shiftBusy.current = true;
      const epoch = getAuthEpoch();
      try {
        await commands.updateEmployeeShift(user.employeeId, {
          status,
          requestId: crypto.randomUUID(),
        });
        return epoch === getAuthEpoch();
      } catch {
        return false;
      } finally {
        shiftBusy.current = false;
      }
    },
  };
}
