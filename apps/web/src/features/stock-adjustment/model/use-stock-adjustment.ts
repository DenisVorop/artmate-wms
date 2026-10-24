"use client";
import { useRef } from "react";
import type {
  AdjustStockDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import {
  toStockAdjustment,
  type AdjustmentValues,
} from "../lib/adjustment-form";
import type { AdjustmentSnapshot } from "../lib/adjustment-targets";

export function useStockAdjustment() {
  const commands = useWarehouseCommands();
  const attempt = useRef<{ key: string; dto: AdjustStockDto } | null>(null);
  const inFlight = useRef<Promise<WorkspaceDto> | null>(null);
  function apply(
    values: AdjustmentValues,
    snapshot: AdjustmentSnapshot,
  ): Promise<WorkspaceDto> {
    if (inFlight.current) return inFlight.current;
    const proposed = toStockAdjustment(values, snapshot);
    const { requestId, ...content } = proposed;
    const key = JSON.stringify(content);
    if (attempt.current?.key !== key) attempt.current = { key, dto: proposed };
    const promise = commands
      .adjustStock(attempt.current.dto)
      .then((data) => {
        attempt.current = null;
        return data;
      })
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = promise;
    return promise;
  }
  return {
    pending: commands.pending,
    error: commands.error,
    clearError: commands.clearError,
    apply,
  };
}
