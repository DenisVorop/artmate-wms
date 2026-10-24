import { A4LabelsPage } from "@/pages/a4-labels-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; id?: string }>;
}) {
  const { type, id } = await searchParams;
  return (
    <A4LabelsPage
      type={type === "location" || type === "work-zone" ? type : undefined}
      id={typeof id === "string" ? id : undefined}
    />
  );
}
