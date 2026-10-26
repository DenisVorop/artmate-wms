"use client";
import Link from "next/link";
import { useSession } from "@/entities/session";
import { getAuthEpoch, getAuthIdentityScope } from "@/shared/api/auth-memory";
import { ForecastingFeature } from "@/features/forecasting";
import { AssemblyPlanningFeature } from "@/features/assembly-planning";
import { WorkspaceShell } from "@/widgets/workspace-shell";
import { LoadingState } from "@/shared/ui";
export function PlanningPage() {
  const session = useSession();
  if (session.isPending || !session.user) return <LoadingState />;
  return (
    <WorkspaceShell>
      {session.isManager ? (
        <div key={`${getAuthIdentityScope()}:${getAuthEpoch()}`}>
          <AssemblyPlanningFeature />
          <ForecastingFeature />
        </div>
      ) : (
        <section className="glass-panel ops-panel">
          <h1 className="page-heading">Раздел доступен руководителю</h1>
          <Link className="button button--primary" href="/work">
            К работе
          </Link>
        </section>
      )}
    </WorkspaceShell>
  );
}
