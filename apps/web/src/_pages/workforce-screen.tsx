"use client";
import { WorkforceReportFeature } from "@/features/workforce-report";
import { WorkspaceShell } from "@/widgets/workspace-shell";
export function WorkforceScreen({
  initialEmployeeId,
}: {
  initialEmployeeId?: string;
}) {
  return (
    <WorkspaceShell>
      <WorkforceReportFeature initialEmployeeId={initialEmployeeId} />
    </WorkspaceShell>
  );
}
