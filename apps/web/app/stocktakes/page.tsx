import { StocktakesScreen } from "@/pages/stocktakes-screen";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ stocktakeId?: string | string[] }>;
}) {
  const params = await searchParams;
  return (
    <StocktakesScreen
      initialDocumentId={
        typeof params.stocktakeId === "string" ? params.stocktakeId : undefined
      }
    />
  );
}
