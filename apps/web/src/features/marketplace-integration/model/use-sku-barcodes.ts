"use client";

import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import { parseAlternateBarcodes } from "../lib/sku-barcodes-form";

export function useSkuBarcodes() {
  const { updateSkuBarcodes, pending, error } = useWarehouseCommands();
  return {
    pending,
    error,
    save: (id: string, text: string) =>
      updateSkuBarcodes(id, {
        requestId: crypto.randomUUID(),
        alternateBarcodes: parseAlternateBarcodes(text),
      }),
  };
}
