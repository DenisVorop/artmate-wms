"use client";
import { useState } from "react";
import { useWorkspace } from "@/entities/workspace";
import { StockLedgerFeature } from "@/features/stock-ledger";
import { StockAdjustmentModal } from "@/features/stock-adjustment";
import { LoadingState, ErrorState } from "@/shared/ui";

export function StockLedgerScreen() {
  const { data, isPending, isError, refetch } = useWorkspace();
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  if (isPending) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;
  return (
    <>
      <StockLedgerFeature
        data={data}
        onCorrection={() => setAdjustmentOpen(true)}
      />
      <StockAdjustmentModal
        data={data}
        open={adjustmentOpen}
        onClose={() => setAdjustmentOpen(false)}
      />
    </>
  );
}
