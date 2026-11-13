import { client, invalid, object, rows, units } from "./http";
import type { Mapping } from "../storage";

export type WbPackage = {
  id: string;
  code: string;
  skuId: string;
  units: number;
};
const base = "https://supplies-api.wildberries.ru/api/v1/supplies";

export async function fetchWbPackageManifest(key: string, supplyId: string) {
  if (!/^[1-9]\d{0,19}$/.test(supplyId)) return invalid();
  const request = client({ Authorization: key }, {});
  const supply = object(await request(`${base}/${supplyId}`));
  if (![2, 3].includes(Number(supply.statusID)))
    return { canPick: false as const };
  const packages = await request(`${base}/${supplyId}/package`);
  const goods = await request(
    `${base}/${supplyId}/goods?limit=1000&offset=0&isPreorderID=false`,
  );
  return { canPick: true as const, packages, goods };
}

export function wbPackageManifest(
  packages: unknown,
  goods: unknown,
  mappings: Mapping[],
): WbPackage[] {
  const declared = new Map<
    string,
    { skuId: string; multiplier: number; remaining: number }
  >();
  for (const item of rows(goods)) {
    const mapping = mappings.find(
      (m) => m.provider === "wildberries" && m.externalId === String(item.nmID),
    );
    if (
      !mapping ||
      typeof item.barcode !== "string" ||
      declared.has(item.barcode)
    )
      throw new Error("Проверьте привязку товаров WB к тематикам WMS.");
    declared.set(item.barcode, {
      skuId: mapping.skuId,
      multiplier: mapping.unitsPerItem,
      remaining: units(item.quantity),
    });
  }
  const ids = new Set<string>();
  const codes = new Set<string>();
  const result = rows(packages).map((pack) => {
    const { packageId: id, packageCode: code } = pack;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      id.length > 200 ||
      ids.has(id) ||
      typeof code !== "string" ||
      !code.trim() ||
      code.length > 200 ||
      codes.has(code)
    )
      throw new Error("WB не вернул уникальные коды всех этикеток.");
    ids.add(id);
    codes.add(code);
    const composition = new Map<string, number>();
    let quantity = 0;
    for (const row of rows(pack.barcodes)) {
      const item =
        typeof row.barcode === "string" ? declared.get(row.barcode) : undefined;
      const count = units(row.quantity);
      if (!item || !count || item.remaining < count)
        throw new Error(
          "Состав грузомест не совпадает с товарами поставки WB.",
        );
      item.remaining -= count;
      quantity += count;
      composition.set(
        item.skuId,
        (composition.get(item.skuId) ?? 0) + count * item.multiplier,
      );
    }
    if (composition.size !== 1 || quantity !== units(pack.quantity))
      throw new Error(
        "Для отбора готового короба грузоместо WB должно содержать одну тематику.",
      );
    const [skuId, unitCount] = [...composition][0];
    return { id, code, skuId, units: unitCount };
  });
  if (
    !result.length ||
    result.length > 1000 ||
    [...declared.values()].some((item) => item.remaining !== 0)
  )
    throw new Error(
      "В WB нет полного списка размеченных грузомест этой поставки.",
    );
  return result;
}
