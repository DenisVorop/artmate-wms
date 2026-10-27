import { OpeningLabelsPage } from "@/pages/opening-labels-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ stocktakeId?: string; locationId?: string }>;
}) {
  const params = await searchParams;
  return (
    <OpeningLabelsPage
      stocktakeId={
        typeof params.stocktakeId === "string" ? params.stocktakeId : ""
      }
      locationId={
        typeof params.locationId === "string" ? params.locationId : ""
      }
    />
  );
}
