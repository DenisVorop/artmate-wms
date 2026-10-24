import type { BoxDto, PalletDto, SkuDto } from "@/shared/api/generated/model";

type PalletStockSource = {
  boxes: Pick<BoxDto, "palletId" | "skuId" | "status" | "units">[];
  skus: Pick<SkuDto, "id" | "name">[];
};
export function palletComposition(data: PalletStockSource, palletId: string) {
  const groups = new Map<
    string,
    { skuId: string; name: string; boxes: number; units: number }
  >();
  for (const box of data.boxes) {
    if (box.palletId !== palletId || box.status !== "stored") continue;
    const entry = groups.get(box.skuId) ?? {
      skuId: box.skuId,
      name: data.skus.find((sku) => sku.id === box.skuId)?.name ?? box.skuId,
      boxes: 0,
      units: 0,
    };
    entry.boxes++;
    entry.units += box.units;
    groups.set(box.skuId, entry);
  }
  return [...groups.values()];
}
export function palletMatchesSkus(
  data: PalletStockSource,
  pallet: Pick<PalletDto, "id" | "skuId" | "kind">,
  skuIds: ReadonlySet<string>,
  unfiltered: boolean,
) {
  if (pallet.kind !== "assembly")
    return pallet.skuId !== null && skuIds.has(pallet.skuId);
  return (
    unfiltered ||
    palletComposition(data, pallet.id).some((row) => skuIds.has(row.skuId))
  );
}
