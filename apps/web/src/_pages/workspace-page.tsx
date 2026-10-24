"use client";
import { EmployeeWorkspace } from "@/widgets/employee-workspace";
import type { EmployeeMode } from "@/features/employee-workday";
import { WorkspaceShell } from "@/widgets/workspace-shell";
import { DashboardFeature } from "@/features/dashboard";
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
import Link from "next/link";
import { LoadingState } from "@/shared/ui";
import { canOpenWorkspaceView, landingForRole } from "./workspace-access";
const views = {
  overview: DashboardFeature,
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
  if (!user || workerLanding)
    return <LoadingState label="Открываем рабочее пространство…" />;
  if (!canOpenWorkspaceView(user.role, view))
    return (
      <WorkspaceShell>
        <section className="glass-panel ops-panel">
          <p className="eyebrow">ДОСТУП К РАЗДЕЛУ</p>
          <h1 className="page-heading">Раздел доступен руководителю</h1>
          <p className="page-description">
            Ваши задания, приёмка и смена доступны в рабочем меню. Для изменения
            прав обратитесь к руководителю.
          </p>
          <Link href="/work" className="button button--primary">
            Перейти к работе
          </Link>
        </section>
      </WorkspaceShell>
    );
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
