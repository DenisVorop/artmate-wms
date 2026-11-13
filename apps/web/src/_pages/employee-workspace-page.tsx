import { EmployeeWorkspace } from "@/widgets/employee-workspace";
import { employeeMode } from "@/features/employee-workday";
export function EmployeeWorkPage({
  mode,
  documentId,
  shipmentId,
}: {
  mode?: string;
  documentId?: string;
  shipmentId?: string;
}) {
  return (
    <EmployeeWorkspace
      initialMode={employeeMode(mode)}
      initialDocumentId={documentId}
      initialShipmentId={shipmentId}
    />
  );
}
