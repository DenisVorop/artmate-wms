import { ozonInbound, ozonSupplies } from "./ozon-supplies";
import {
  barcodes,
  client,
  id,
  invalid,
  moscowDate,
  object,
  rows,
  text,
  units,
  MarketplaceProviderError,
} from "./http";
import type {
  MarketplaceCredentials,
  MarketplaceDemand,
  MarketplaceFetchOptions,
  MarketplacePeriod,
  MarketplaceProduct,
  MarketplaceSnapshot,
  MarketplaceStock,
} from "./types";

export async function ozon(
  credentials: MarketplaceCredentials,
  period: MarketplacePeriod,
  options: MarketplaceFetchOptions,
): Promise<MarketplaceSnapshot> {
  const request = client(
    { "Api-Key": credentials.apiKey, "Client-Id": credentials.clientId! },
    options,
  );
  const products = new Map<string, MarketplaceProduct>();
  const catalogIds = new Set<string>();
  let lastId = "";
  const catalogCursors = new Set<string>();
  for (let page = 0; ; page++) {
    if (page >= 100)
      throw new MarketplaceProviderError(
        "limit",
        "Каталог Ozon слишком большой для одной загрузки.",
      );
    const result = object(
      object(
        await request("https://api-seller.ozon.ru/v3/product/list", {
          filter: { visibility: "ALL" },
          last_id: lastId,
          limit: 1000,
        }),
      ).result,
    );
    const items = rows(result.items);
    for (const item of items) catalogIds.add(id(item.product_id));
    if (!items.length) break;
    const next =
      typeof result.last_id === "string" ? result.last_id : invalid();
    if (!next) break;
    if (catalogCursors.has(next)) return invalid();
    catalogCursors.add(next);
    lastId = next;
    // total is deprecated; cursor+empty page works without either total/total_items.
  }
  const ids = [...catalogIds];
  for (let start = 0; start < ids.length; start += 1000) {
    const batch = ids.slice(start, start + 1000);
    const result = object(
      await request("https://api-seller.ozon.ru/v3/product/info/list", {
        product_id: batch,
      }),
    );
    const details = rows(result.items);
    const returned = new Set(details.map((item) => id(item.id)));
    if (batch.some((value) => !returned.has(value))) return invalid();
    for (const item of details) {
      const externalId = id(item.sku);
      products.set(externalId, {
        externalId,
        offerId: text(item.offer_id, externalId),
        name: text(item.name, externalId),
        barcodes: barcodes(item.barcodes),
      });
    }
  }
  const stocks = new Map<string, MarketplaceStock>();
  const skus = [...products.keys()];
  for (let start = 0; start < skus.length; start += 100) {
    const result = object(
      await request("https://api-seller.ozon.ru/v1/analytics/stocks", {
        skus: skus.slice(start, start + 100),
      }),
    );
    for (const item of rows(result.items)) {
      const externalId = id(item.sku),
        warehouseId = id(item.warehouse_id);
      if (!products.has(externalId))
        products.set(externalId, {
          externalId,
          offerId: text(item.offer_id, externalId),
          name: text(item.name, `Ozon ${externalId}`),
          barcodes: [],
        });
      const key = `${externalId}:${warehouseId}`;
      // Same SKU/warehouse twice has no documented additive semantics; reject rather than double count.
      if (stocks.has(key)) return invalid();
      stocks.set(key, {
        externalId,
        warehouseId,
        warehouseName: text(item.warehouse_name, warehouseId),
        availableUnits: units(item.available_stock_count),
        reservedUnits: null,
        inboundUnits:
          item.transit_stock_count === undefined
            ? null
            : units(item.transit_stock_count),
      });
    }
  }
  const demand = new Map<string, MarketplaceDemand>();
  const seenPostings = new Set<string>(),
    cursors = new Set<string>();
  let cursor = "";
  const since = new Date(`${period.from}T00:00:00+03:00`).toISOString();
  const to = new Date(
    new Date(`${period.to}T00:00:00+03:00`).getTime() + 86_400_000 - 1,
  ).toISOString();
  for (let page = 0; ; page++) {
    if (page >= 1000)
      throw new MarketplaceProviderError(
        "limit",
        "Слишком много отправлений Ozon. Сократите период.",
      );
    const result = object(
      await request("https://api-seller.ozon.ru/v3/posting/fbo/list", {
        cursor,
        filter: { since, to },
        limit: 100,
        sort_dir: "ASC",
        translit: false,
        with: {
          analytics_data: false,
          financial_data: false,
          legal_info: false,
        },
      }),
    );
    for (const posting of rows(result.postings)) {
      const postingId = id(posting.posting_number);
      if (seenPostings.has(postingId)) return invalid();
      seenPostings.add(postingId);
      const date = moscowDate(posting.created_at);
      if (date < period.from || date > period.to) continue;
      // External orders from other platforms must not enter the marketplace demand forecast.
      if (
        posting.external_order &&
        object(posting.external_order).is_external === true
      )
        continue;
      const status = text(posting.status, "");
      if (!status) return invalid();
      for (const item of rows(posting.products)) {
        const externalId = id(item.sku),
          quantity = units(item.quantity);
        if (!products.has(externalId))
          products.set(externalId, {
            externalId,
            offerId: text(item.offer_id, externalId),
            name: text(item.name, externalId),
            barcodes: [],
          });
        const key = `${externalId}:${date}`;
        if (!demand.has(key))
          demand.set(key, {
            externalId,
            date,
            orderedUnits: 0,
            cancelledUnits: 0,
            returnedUnits: 0,
            soldUnits: null,
          });
        const current = demand.get(key)!;
        current.orderedUnits += quantity;
        if (status === "cancelled") current.cancelledUnits += quantity;
      }
    }
    if (typeof result.has_next !== "boolean") return invalid();
    if (!result.has_next) break;
    const next = id(result.cursor);
    if (next === cursor || cursors.has(next)) return invalid();
    cursors.add(next);
    cursor = next;
  }
  const supplies = await ozonSupplies(request, products);
  const stockProducts = new Set(
    [...stocks.values()].map((stock) => stock.externalId),
  );
  for (const externalId of products.keys())
    if (!stockProducts.has(externalId))
      stocks.set(`${externalId}:unknown`, {
        externalId,
        warehouseId: "unknown",
        warehouseName: "Остаток не подтверждён",
        availableUnits: null,
        reservedUnits: null,
        inboundUnits: null,
      });
  const inbound = ozonInbound(products.values(), stocks.values(), supplies);
  const inboundComplete = inbound.every((item) => item.units !== null);
  return {
    provider: "ozon",
    ...period,
    asOf: new Date().toISOString(),
    products: [...products.values()],
    inbound,
    supplies,
    stocks: [...stocks.values()],
    demand: [...demand.values()],
    coverage: {
      catalog: true,
      stocks: true,
      demand: true,
      inbound: inboundComplete,
    },
    warnings: [
      "Ozon: спрос считается по дате создания FBO-отправления с учётом его текущей отмены. Выкупы и возвраты по финансовым отчётам не загружены; returnedUnits=0 здесь не подтверждает отсутствие возвратов.",
      "Ozon: количество в пути — только transit_stock_count из аналитики. Документы поставок загружаются для проверки; их количества повторно не прибавляются. Черновики и запланированные поставки не считаются отправленными.",
      "Ozon: отсутствие строки остатков не подтверждает нулевой остаток товара. Резервы не загружены.",
    ],
  };
}
