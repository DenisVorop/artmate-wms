import { EmployeeWorkspace } from "@/widgets/employee-workspace";
import { employeeMode } from "@/features/employee-workday";
export function EmployeeWorkPage({
  mode,
  documentId,
}: {
  mode?: string;
  documentId?: string;
}) {
  return (
    <EmployeeWorkspace
      initialMode={employeeMode(mode)}
      initialDocumentId={documentId}
    />
  );
}
