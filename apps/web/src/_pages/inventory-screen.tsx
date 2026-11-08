"use client";
import { useState } from "react";
import { useSession } from "@/entities/session";
import { useWorkspace } from "@/entities/workspace";
import { ConsumablesFeature } from "@/features/consumables";
import { InventoryFeature } from "@/features/inventory";
import { PackagingFeature } from "@/features/packaging";
import { StockAdjustmentModal } from "@/features/stock-adjustment";

export function InventoryScreen() {
  const { data } = useWorkspace();
  const { isManager } = useSession();
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  return (
    <>
      <InventoryFeature onCorrection={() => setAdjustmentOpen(true)} />
      {isManager && data && <ConsumablesFeature data={data} />}
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
