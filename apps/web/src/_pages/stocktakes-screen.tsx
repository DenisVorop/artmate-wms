"use client";
import { StocktakesFeature } from "@/features/stocktakes";
import { WorkspaceShell } from "@/widgets/workspace-shell";
export function StocktakesScreen({
  initialDocumentId,
}: {
  initialDocumentId?: string;
}) {
  return (
    <WorkspaceShell>
      <StocktakesFeature initialDocumentId={initialDocumentId} />
    </WorkspaceShell>
  );
}
