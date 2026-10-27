import { OpeningLabelsFeature } from "@/features/opening-labels";
export function OpeningLabelsPage({
  stocktakeId,
  locationId,
}: {
  stocktakeId: string;
  locationId: string;
}) {
  return (
    <main>
      <OpeningLabelsFeature stocktakeId={stocktakeId} locationId={locationId} />
    </main>
  );
}
