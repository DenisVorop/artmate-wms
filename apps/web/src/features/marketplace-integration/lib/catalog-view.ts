import type {
  MarketplaceProductDto,
  MarketplaceSupplyDto,
} from "@/entities/marketplaces";

export const supplyNumber = (id: string) =>
  id.replace(/^(?:supply|preorder):/, "");

function includesSearch(values: (string | null | undefined)[], query: string) {
  return values.some((value) =>
    value?.toLocaleLowerCase("ru-RU").includes(query),
  );
}

export function filterCatalog(
  products: MarketplaceProductDto[],
  supplies: MarketplaceSupplyDto[],
  {
    provider,
    search,
    mapping,
    supply,
    skuNames,
  }: {
    provider: string;
    search: string;
    mapping: string;
    supply: string;
    skuNames: Map<string, string>;
  },
) {
  const query = search.trim().toLocaleLowerCase("ru-RU");
  return {
    products: products.filter(
      (item) =>
        (!provider || item.provider === provider) &&
        (!mapping || !!item.skuId === (mapping === "linked")) &&
        (!query ||
          includesSearch(
            [
              item.name,
              item.offerId,
              item.externalId,
              item.skuId ? skuNames.get(item.skuId) : undefined,
              ...item.barcodes,
            ],
            query,
          )),
    ),
    supplies: supplies.filter(
      (item) =>
        (!provider || item.provider === provider) &&
        (!supply || item.calculation === supply) &&
        (!query ||
          includesSearch(
            [
              supplyNumber(item.id),
              ...item.items.map((product) => product.name),
            ],
            query,
          )),
    ),
  };
}
