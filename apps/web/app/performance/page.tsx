import { WorkforceScreen } from "@/pages/workforce-screen";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ employeeId?: string | string[] }>;
}) {
  const params = await searchParams;
  return (
    <WorkforceScreen
      initialEmployeeId={
        typeof params.employeeId === "string" ? params.employeeId : undefined
      }
    />
  );
}
