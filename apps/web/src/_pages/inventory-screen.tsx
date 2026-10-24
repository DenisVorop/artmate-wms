"use client";
import { useState } from "react";
import { useWorkspace } from "@/entities/workspace";
import { InventoryFeature } from "@/features/inventory";
import { PackagingFeature } from "@/features/packaging";
import { StockAdjustmentModal } from "@/features/stock-adjustment";

export function InventoryScreen() {
  const { data } = useWorkspace();
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  return (
    <>
      <InventoryFeature onCorrection={() => setAdjustmentOpen(true)} />
      <PackagingFeature />
      {data && (
        <StockAdjustmentModal
          data={data}
          open={adjustmentOpen}
          onClose={() => setAdjustmentOpen(false)}
        />
      )}
    </>
  );
}
