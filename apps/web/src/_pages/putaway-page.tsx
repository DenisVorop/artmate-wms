"use client";
import { useSession } from "@/entities/session";
import { EmployeeWorkspace } from "@/widgets/employee-workspace";
import { PutawayFeature } from "@/features/putaway";
import { WorkspaceShell } from "@/widgets/workspace-shell";
export function PutawayPage() {
  const { user } = useSession();
  if (user?.role === "employee")
    return <EmployeeWorkspace initialMode="putaway" />;
  return (
    <WorkspaceShell>
      <PutawayFeature />
    </WorkspaceShell>
  );
}
