"use client";
import { useSession } from "@/entities/session";
import { getAuthEpoch, getAuthIdentityScope } from "@/shared/api/auth-memory";
import { MarketplaceIntegrationFeature } from "@/features/marketplace-integration";
import { WorkspaceShell } from "@/widgets/workspace-shell";
import { LoadingState } from "@/shared/ui";
import Link from "next/link";
export function MarketplacesPage() {
  const session = useSession();
  if (session.isPending || !session.user) return <LoadingState />;
  return (
    <WorkspaceShell theme="light" showFooter={false}>
      {session.isManager ? (
        <MarketplaceIntegrationFeature
          key={`${getAuthIdentityScope()}:${getAuthEpoch()}`}
        />
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
