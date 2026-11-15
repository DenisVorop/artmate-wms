"use client";
import { WorkforceReportFeature } from "@/features/workforce-report";
import { WorkspaceShell } from "@/widgets/workspace-shell";
export function WorkforceScreen({
  initialEmployeeId,
}: {
  initialEmployeeId?: string;
}) {
  return (
    <WorkspaceShell theme="light" showFooter={false}>
      <WorkforceReportFeature
        key={initialEmployeeId}
        initialEmployeeId={initialEmployeeId}
      />
    </WorkspaceShell>
  );
}
