"use client";
import { useWorkspace } from "@/entities/workspace";
import { useSession } from "@/entities/session";
import { TeamFeature } from "@/features/team";
import { AccessManagementFeature } from "@/features/access-management";
export function TeamScreen() {
  const { data } = useWorkspace();
  const { isManager } = useSession();
  return (
    <>
      <TeamFeature />
      {isManager && data && <AccessManagementFeature data={data} />}
    </>
  );
}
