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

export async function wildberries(
  credentials: MarketplaceCredentials,
  period: MarketplacePeriod,
  options: MarketplaceFetchOptions,
): Promise<MarketplaceSnapshot> {
  const request = client({ Authorization: credentials.apiKey }, options);
  const products = new Map<string, MarketplaceProduct>();
  let cursor: Record<string, unknown> = { limit: 100 };
  const catalogCursors = new Set<string>();
  for (let page = 0; ; page++) {
    if (page >= 100)
      throw new MarketplaceProviderError(
        "limit",
        "Каталог Wildberries слишком большой для одной загрузки.",
      );
    const result = object(
      await request(
        "https://content-api.wildberries.ru/content/v2/get/cards/list",
        {
          settings: {
            sort: { ascending: true },
            cursor,
            filter: { withPhoto: -1 },
          },
        },
      ),
    );
    for (const card of rows(result.cards)) {
      const externalId = id(card.nmID);
      const codes = rows(card.sizes).flatMap((size) => barcodes(size.skus));
      products.set(externalId, {
        externalId,
        offerId: text(card.vendorCode, externalId),
        name: text(card.title, text(card.vendorCode, externalId)),
        barcodes: [...new Set(codes)],
      });
    }
    const next = object(result.cursor);
    if (units(next.total) < 100) break;
    const key = `${id(next.nmID)}:${id(next.updatedAt)}`;
    if (catalogCursors.has(key)) return invalid();
    catalogCursors.add(key);
    cursor = { limit: 100, nmID: next.nmID, updatedAt: next.updatedAt };
  }
  const stocks = new Map<string, MarketplaceStock>();
  const stockRows = new Set<string>();
  for (let offset = 0; ; offset += 10_000) {
    if (offset >= 100_000)
      throw new MarketplaceProviderError(
        "limit",
        "Остатки Wildberries превысили размер одной загрузки.",
      );
    const raw = await request(
      "https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses",
      { nmIds: [], limit: 10_000, offset },
    );
    const batch = raw === null ? [] : rows(object(object(raw).data).items);
    for (const stock of batch) {
      const externalId = id(stock.nmId),
        warehouseId = id(stock.warehouseId);
      const rowKey = `${externalId}:${warehouseId}:${id(stock.chrtId)}`;
      if (stockRows.has(rowKey)) return invalid();
      stockRows.add(rowKey);
      if (!products.has(externalId))
        products.set(externalId, {
          externalId,
          name: `WB ${externalId}`,
          barcodes: [],
        });
      const key = `${externalId}:${warehouseId}`;
      const existing = stocks.get(key);
      stocks.set(key, {
        externalId,
        warehouseId,
        warehouseName: text(stock.warehouseName, warehouseId),
        availableUnits: (existing?.availableUnits ?? 0) + units(stock.quantity),
        reservedUnits: null,
        inboundUnits: null,
      });
    }
    if (batch.length < 10_000) break;
  }
  const demand = new Map<string, MarketplaceDemand>();
  let unknownWarehouse = false;
  const cell = (externalId: string, date: string) => {
    const key = `${externalId}:${date}`;
    if (!demand.has(key))
      demand.set(key, {
        externalId,
        date,
        orderedUnits: 0,
        cancelledUnits: 0,
        returnedUnits: 0,
        soldUnits: 0,
      });
    return demand.get(key)!;
  };
  for (const kind of ["orders", "sales"] as const) {
    let dateFrom = `${period.from}T00:00:00`;
    const seen = new Map<string, Record<string, unknown>>();
    const cursors = new Set<string>();
    for (let page = 0; ; page++) {
      if (page >= 20)
        throw new MarketplaceProviderError(
          "limit",
          "Отчёт Wildberries слишком большой. Сократите период.",
        );
      const batch = rows(
        await request(
          `https://statistics-api.wildberries.ru/api/v1/supplier/${kind}?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`,
        ),
      );
      if (!batch.length) break;
      for (const row of batch) {
        // lastChangeDate pagination can repeat the boundary record. The latest payload wins.
        const key = kind === "orders" ? id(row.srid) : id(row.saleID);
        seen.set(key, row);
      }
      const next = id(batch.at(-1)!.lastChangeDate);
      if (next === dateFrom || cursors.has(next)) return invalid();
      cursors.add(next);
      dateFrom = next;
    }
    for (const row of seen.values()) {
      const date = moscowDate(row.date);
      if (date < period.from || date > period.to) continue;
      if (row.warehouseType !== "Склад WB") {
        if (row.warehouseType !== "Склад продавца") unknownWarehouse = true;
        continue;
      }
      const externalId = id(row.nmId);
      if (!products.has(externalId))
        products.set(externalId, {
          externalId,
          offerId: text(row.supplierArticle, externalId),
          name: text(row.supplierArticle, externalId),
          barcodes: typeof row.barcode === "string" ? [row.barcode] : [],
        });
      const current = cell(externalId, date);
      if (kind === "orders") {
        if (typeof row.isCancel !== "boolean") return invalid();
        current.orderedUnits++;
        if (row.isCancel) current.cancelledUnits++;
      } else {
        const sale = id(row.saleID);
        if (sale.startsWith("S")) current.soldUnits!++;
        else if (sale.startsWith("R")) current.returnedUnits++;
        else return invalid();
      }
    }
  }
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
  return {
    provider: "wildberries",
    ...period,
    asOf: new Date().toISOString(),
    products: [...products.values()],
    stocks: [...stocks.values()],
    demand: [...demand.values()],
    coverage: {
      catalog: true,
      stocks: true,
      demand: !unknownWarehouse,
      inbound: false,
    },
    warnings: [
      "WB: оперативные заказы и продажи предварительные; неоплаченные заказы могут отсутствовать. История ограничена 90 днями.",
      "WB: поставки на склад в пути и резервы не загружены. Доставка покупателю и возврат от покупателя не считаются входящей поставкой.",
      "WB: текущий API может объединять склады в «Склад WB».",
      ...(unknownWarehouse
        ? [
            "WB: строки с неизвестным типом склада исключены, покрытие спроса неполное.",
          ]
        : []),
    ],
  };
}
