"use client";
import { Suspense, useState } from "react";
import { useSession } from "@/entities/session";
import { useWorkspace } from "@/entities/workspace";
import { ConsumablesFeature } from "@/features/consumables";
import { InventoryFeature } from "@/features/inventory";
import { PackagingFeature } from "@/features/packaging";
import { StockAdjustmentModal } from "@/features/stock-adjustment";
import { LoadingState } from "@/shared/ui";

export function InventoryScreen() {
  const { data } = useWorkspace();
  const { isManager } = useSession();
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  return (
    <>
      <Suspense fallback={<LoadingState />}>
        <InventoryFeature onCorrection={() => setAdjustmentOpen(true)} />
      </Suspense>
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
