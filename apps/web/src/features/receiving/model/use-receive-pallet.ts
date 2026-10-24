"use client";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import {
  buildReceipt,
  type PlacementValues,
  type ReceiptValues,
} from "../lib/receipt-form";
export function useReceivePallet() {
  const commands = useWarehouseCommands();
  return {
    pending: commands.pending,
    error: commands.error,
    clearError: commands.clearError,
    receive: (values: ReceiptValues) =>
      commands.createReceipt(buildReceipt(values)),
    place: (receiptId: string, palletId: string, values: PlacementValues) =>
      commands.placeReceiptPallet(receiptId, palletId, {
        ...values,
        requestId: crypto.randomUUID(),
      }),
  };
}
