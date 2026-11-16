"use client";
import { useSession } from "@/entities/session";
import { getAuthEpoch, getAuthIdentityScope } from "@/shared/api/auth-memory";
import { MarketplaceIntegrationFeature } from "@/features/marketplace-integration";
import { WorkspaceShell } from "@/widgets/workspace-shell";
import { LoadingState } from "@/shared/ui";
import { AccessDenied } from "../access-denied";
export function MarketplacesPage() {
  const session = useSession();
  if (session.isPending || !session.user) return <LoadingState />;
  if (!session.isManager) return <AccessDenied />;
  return (
    <WorkspaceShell>
      <MarketplaceIntegrationFeature
        key={`${getAuthIdentityScope()}:${getAuthEpoch()}`}
      />
    </WorkspaceShell>
  );
}
