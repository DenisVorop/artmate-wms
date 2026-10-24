"use client";
import { useRef } from "react";
import { useSession } from "@/entities/session";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import { getAuthEpoch } from "@/shared/api/auth-memory";
export function useHandling() {
  const { user } = useSession();
  const commands = useWarehouseCommands();
  const lock = useRef(false);
  async function execute(
    command: () => Promise<unknown>,
    onSuccess?: () => void,
  ) {
    if (lock.current || !user?.employeeId) return false;
    const epoch = getAuthEpoch();
    lock.current = true;
    try {
      await command();
      if (epoch !== getAuthEpoch()) return false;
      onSuccess?.();
      return true;
    } catch {
      return false;
    } finally {
      lock.current = false;
    }
  }
  return { employeeId: user?.employeeId ?? "", commands, execute };
}
