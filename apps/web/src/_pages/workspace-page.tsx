import { WorkspaceShell } from "@/widgets/workspace-shell";
import { DashboardFeature } from "@/features/dashboard";
import { WarehouseLayoutFeature } from "@/features/warehouse-layout";
import { PackagingFeature } from "@/features/packaging";
import { InventoryFeature } from "@/features/inventory";
import { ReceivingFeature } from "@/features/receiving";
import { AssemblyFeature } from "@/features/assembly";
import { ShipmentsFeature } from "@/features/shipments";
import { MovementsFeature } from "@/features/movements";
import { TeamFeature } from "@/features/team";
function InventoryScreen() {
  return (
    <>
      <InventoryFeature />
      <PackagingFeature />
    </>
  );
}
const views = {
  overview: DashboardFeature,
  warehouse: WarehouseLayoutFeature,
  inventory: InventoryScreen,
  receiving: ReceivingFeature,
  assembly: AssemblyFeature,
  shipments: ShipmentsFeature,
  team: TeamFeature,
  movements: MovementsFeature,
};
export type WorkspaceView = keyof typeof views;
export function WorkspacePage({ view }: { view: WorkspaceView }) {
  const Feature = views[view];
  return (
    <WorkspaceShell>
      <Feature />
    </WorkspaceShell>
  );
}
