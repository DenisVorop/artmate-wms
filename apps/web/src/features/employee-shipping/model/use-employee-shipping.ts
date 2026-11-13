"use client";
import { useRef, useState } from "react";
import { useSession } from "@/entities/session";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import type { ShipmentDto, WorkspaceDto } from "@/shared/api/generated/model";

export function useEmployeeShipping() {
  const { user } = useSession();
  const commands = useWarehouseCommands();
  const busy = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const employeeId = user?.employeeId ?? "";
  const run = async (
    shipment: ShipmentDto,
    command: () => Promise<WorkspaceDto>,
    finished = false,
  ) => {
    if (busy.current || !employeeId || shipment.employeeId !== employeeId)
      return false;
    busy.current = true;
    try {
      await command();
      setNotice(
        finished
          ? `Отгружено коробов: ${shipment.boxesRequested}. Остатки обновлены.`
          : null,
      );
      return true;
    } catch {
      return false;
    } finally {
      busy.current = false;
    }
  };
  return {
    pending: commands.pending,
    error: commands.error,
    notice,
    claim: async (id: string) => {
      if (busy.current || !employeeId) return false;
      busy.current = true;
      try {
        await commands.claimShipmentWork(id, {
          requestId: crypto.randomUUID(),
          employeeId,
        });
        setNotice(null);
        return true;
      } catch {
        return false;
      } finally {
        busy.current = false;
      }
    },
    scan: (shipment: ShipmentDto, boxCode: string) =>
      run(shipment, () =>
        commands.scanShipmentWork(shipment.id, {
          requestId: crypto.randomUUID(),
          employeeId,
          boxCode,
        }),
      ),
    finish: (shipment: ShipmentDto, zoneId: string) =>
      run(
        shipment,
        () =>
          commands.finishShipmentWork(shipment.id, {
            requestId: crypto.randomUUID(),
            employeeId,
            zoneCode: `artmate-wms:work-zone:${zoneId}`,
          }),
        true,
      ),
  };
}
