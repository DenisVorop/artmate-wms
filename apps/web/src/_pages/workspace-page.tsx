"use client";
import { EmployeeWorkspace } from "@/widgets/employee-workspace";
import type { EmployeeMode } from "@/features/employee-workday";
import { WorkspaceShell } from "@/widgets/workspace-shell";
import { OverviewScreen } from "./overview-screen";
import { WarehouseLayoutFeature } from "@/features/warehouse-layout";
import { InventoryScreen } from "./inventory-screen";
import { StockLedgerScreen } from "./stock-ledger-screen";
import { ReceivingFeature } from "@/features/receiving";
import { AssemblyFeature } from "@/features/assembly";
import { ShipmentsFeature } from "@/features/shipments";
import { MovementsFeature } from "@/features/movements";
import { TeamScreen } from "./team-screen";
import { useSession } from "@/entities/session";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AccessDenied } from "./access-denied";
import { LoadingState } from "@/shared/ui";
import { canOpenWorkspaceView, landingForRole } from "./workspace-access";
const views = {
  overview: OverviewScreen,
  warehouse: WarehouseLayoutFeature,
  inventory: InventoryScreen,
  "stock-ledger": StockLedgerScreen,
  receiving: ReceivingFeature,
  assembly: AssemblyFeature,
  shipments: ShipmentsFeature,
  team: TeamScreen,
  movements: MovementsFeature,
};
export type WorkspaceView = keyof typeof views;
export function WorkspacePage({ view }: { view: WorkspaceView }) {
  const { user } = useSession();
  const router = useRouter();
  const workerLanding = user?.role === "employee" && view === "overview";
  useEffect(() => {
    if (workerLanding) router.replace(landingForRole("employee"));
  }, [workerLanding, router]);
  if (!user || workerLanding) return <LoadingState />;
  if (!canOpenWorkspaceView(user.role, view)) return <AccessDenied />;
  const workerModes: Partial<Record<WorkspaceView, EmployeeMode>> = {
    assembly: "assembly",
    receiving: "receiving",
    movements: "movements",
    team: "shift",
  };
  if (user.role === "employee" && workerModes[view])
    return <EmployeeWorkspace key={view} initialMode={workerModes[view]} />;
  const Feature = views[view];
  return (
    <WorkspaceShell>
      <Feature />
    </WorkspaceShell>
  );
}
