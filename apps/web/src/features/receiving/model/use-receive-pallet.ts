"use client";
import { useSession } from "@/entities/session";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import {
  buildPlacement,
  buildReceipt,
  type PlacementValues,
  type ReceiptValues,
} from "../lib/receipt-form";
export function useReceivePallet() {
  const commands = useWarehouseCommands();
  const { user } = useSession();
  const actorId = user?.employeeId ?? "";
  return {
    pending: commands.pending,
    error: commands.error,
    clearError: commands.clearError,
    receive: (values: ReceiptValues) =>
      commands.createReceipt(buildReceipt(values)),
    place: (receiptId: string, palletId: string, values: PlacementValues) =>
      commands.placeReceiptPallet(
        receiptId,
        palletId,
        buildPlacement(values, actorId),
      ),
  };
}
