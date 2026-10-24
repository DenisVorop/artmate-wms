import { EmployeeWorkPage } from "@/pages/employee-workspace-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; stocktakeId?: string }>;
}) {
  const p = await searchParams;
  return <EmployeeWorkPage mode={p.mode} documentId={p.stocktakeId} />;
}
