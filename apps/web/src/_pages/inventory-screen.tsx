"use client";

import { Suspense, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useSession } from "@/entities/session";
import { useWorkspace } from "@/entities/workspace";
import { ConsumablesFeature } from "@/features/consumables";
import { InventoryFeature } from "@/features/inventory";
import { PackagingFeature } from "@/features/packaging";
import { StockAdjustmentModal } from "@/features/stock-adjustment";
import { LoadingState } from "@/shared/ui";
import styles from "./inventory-screen.module.css";

export function InventoryScreen() {
  const { data } = useWorkspace();
  const { isManager } = useSession();
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);

  return (
    <div className={styles.page}>
      <h1 className="page-heading">Остатки</h1>
      <Suspense fallback={<LoadingState />}>
        <InventoryFeature
          onCorrection={isManager ? () => setAdjustmentOpen(true) : undefined}
        />
      </Suspense>
      {isManager && data && (
        <>
          <div className={styles.settings}>
            <details>
              <summary>
                Расходники для сборки{" "}
                <ChevronDown size={16} aria-hidden="true" />
              </summary>
              <ConsumablesFeature data={data} />
            </details>
            <details>
              <summary>
                Профили упаковки <ChevronDown size={16} aria-hidden="true" />
              </summary>
              <PackagingFeature />
            </details>
          </div>
          <StockAdjustmentModal
            data={data}
            open={adjustmentOpen}
            onClose={() => setAdjustmentOpen(false)}
          />
        </>
      )}
    </div>
  );
}
