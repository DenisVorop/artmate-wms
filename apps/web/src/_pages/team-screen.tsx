"use client";
import { TeamFeature } from "@/features/team";
import { AccessManagementFeature } from "@/features/access-management";

export function TeamScreen() {
  return (
    <TeamFeature
      employeeAccess={(employee, data) => (
        <AccessManagementFeature
          key={employee.id}
          data={data}
          employee={employee}
        />
      )}
      otherAccounts={(data) => <AccessManagementFeature data={data} />}
    />
  );
}
