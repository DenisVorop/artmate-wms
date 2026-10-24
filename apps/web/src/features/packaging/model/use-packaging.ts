"use client";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import { buildPackaging, type PackagingValues } from "../lib/packaging-form";
export function usePackaging() {
  const commands = useWarehouseCommands();
  return {
    pending: commands.pending,
    error: commands.error,
    save: (id: string, values: PackagingValues) =>
      commands.updateSkuPackaging(id, buildPackaging(values)),
  };
}
