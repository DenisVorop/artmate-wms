"use client";
import { useSession } from "@/entities/session";
import { getAuthEpoch, getAuthIdentityScope } from "@/shared/api/auth-memory";
import { ForecastingFeature } from "@/features/forecasting";
import type { ForecastRowDto } from "@/entities/forecast";
import type { MarketplacePlanDto } from "@/entities/assembly-plan";
import { AssemblyPlanningFeature } from "@/features/assembly-planning";
import { WorkspaceShell } from "@/widgets/workspace-shell";
import { LoadingState } from "@/shared/ui";
import { AccessDenied } from "../access-denied";
export function PlanningPage({
  preview,
  forecastPreview,
}: { preview?: MarketplacePlanDto; forecastPreview?: ForecastRowDto[] } = {}) {
  const session = useSession();
  if (session.isPending || !session.user) return <LoadingState />;
  if (!session.isManager) return <AccessDenied />;
  return (
    <WorkspaceShell>
      <div key={`${getAuthIdentityScope()}:${getAuthEpoch()}`}>
        <AssemblyPlanningFeature preview={preview} />
        <ForecastingFeature preview={forecastPreview} />
      </div>
    </WorkspaceShell>
  );
}
