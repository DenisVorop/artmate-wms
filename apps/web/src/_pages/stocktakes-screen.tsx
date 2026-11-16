"use client";
import { useSession } from "@/entities/session";
import { EmployeeWorkspace } from "@/widgets/employee-workspace";
import { StocktakesFeature } from "@/features/stocktakes";
import { WorkspaceShell } from "@/widgets/workspace-shell";
export function StocktakesScreen({
  initialDocumentId,
}: {
  initialDocumentId?: string;
}) {
  const { user } = useSession();
  if (user?.role === "employee")
    return (
      <EmployeeWorkspace
        initialMode="stocktakes"
        initialDocumentId={initialDocumentId}
      />
    );
  return (
    <WorkspaceShell>
      <StocktakesFeature
        key={initialDocumentId ?? ""}
        initialDocumentId={initialDocumentId}
      />
    </WorkspaceShell>
  );
}
