"use client";
import { useRef } from "react";
import { useSession } from "@/entities/session";
import type { EmployeeScanDisposition } from "@/shared/ui";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import { isWorkZoneScan } from "../lib/zone-work";
export function useEmployeeZone({
  blocked,
  onProblem,
  onStarted,
}: {
  blocked: boolean;
  onProblem: (message: string) => void;
  onStarted: () => void;
}) {
  const { user } = useSession(),
    commands = useWarehouseCommands(),
    lock = useRef(false);
  const start = async (
    zoneCode: string,
    intent: "open-queue" | "take-next",
  ): Promise<EmployeeScanDisposition> => {
    if (!isWorkZoneScan(zoneCode)) return "pass";
    if (blocked || lock.current) {
      onProblem(
        "Сначала сохраните текущий ввод или исправьте непринятый скан.",
      );
      return "blocked";
    }
    if (!user) return "blocked";
    lock.current = true;
    try {
      await commands.startZoneWork({
        requestId: crypto.randomUUID(),
        employeeId: user.employeeId,
        zoneCode: zoneCode.trim(),
        intent,
      });
      onStarted();
      return "handled";
    } catch (error) {
      onProblem(
        error instanceof Error
          ? error.message
          : "Не удалось начать работу в зоне. Повторите скан.",
      );
      return "blocked";
    } finally {
      lock.current = false;
    }
  };
  return {
    pending: commands.pending,
    intercept: (value: string) => start(value, "open-queue"),
    takeNext: (zoneId: string) =>
      start(`artmate-wms:work-zone:${zoneId}`, "take-next"),
    leave: async () => {
      if (blocked || lock.current || !user) return false;
      lock.current = true;
      try {
        await commands.leaveZoneWork({
          requestId: crypto.randomUUID(),
          employeeId: user.employeeId,
        });
        return true;
      } catch (error) {
        onProblem(
          error instanceof Error ? error.message : "Не удалось сменить работу.",
        );
        return false;
      } finally {
        lock.current = false;
      }
    },
  };
}
