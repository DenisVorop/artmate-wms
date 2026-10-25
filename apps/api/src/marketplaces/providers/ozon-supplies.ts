import {
  id,
  invalid,
  MarketplaceProviderError,
  object,
  rows,
  text,
  units,
} from "./http";
import type {
  MarketplaceInbound,
  MarketplaceProduct,
  MarketplaceStock,
  MarketplaceSupply,
} from "./types";

type Request = (url: string, body?: unknown) => Promise<unknown>;
const states = {
  DATA_FILLING: "Заполнение заявки",
  READY_TO_SUPPLY: "Готова к поставке",
  ACCEPTED_AT_SUPPLY_WAREHOUSE: "Принята на складе отгрузки",
  IN_TRANSIT: "В пути",
  ACCEPTANCE_AT_STORAGE_WAREHOUSE: "Приёмка на складе хранения",
  REPORTS_CONFIRMATION_AWAITING: "Ожидает подтверждения актов",
  REPORT_REJECTED: "Акт отклонён",
  COMPLETED: "Завершена",
  REJECTED_AT_SUPPLY_WAREHOUSE: "Отклонена на складе отгрузки",
  CANCELLED: "Отменена",
  OVERDUE: "Просрочена",
  UNSPECIFIED: "Статус не определён",
} as const;
const activeStates = Object.keys(states).filter(
  (state) =>
    ![
      "COMPLETED",
      "REJECTED_AT_SUPPLY_WAREHOUSE",
      "CANCELLED",
      "OVERDUE",
      "UNSPECIFIED",
    ].includes(state),
);
const planned = new Set(["DATA_FILLING", "READY_TO_SUPPLY"]);
const excluded = new Set([
  "COMPLETED",
  "REJECTED_AT_SUPPLY_WAREHOUSE",
  "CANCELLED",
  "OVERDUE",
]);
const numericId = (value: unknown): string => {
  const result = id(value);
  if (!/^[1-9]\d{0,19}$/.test(result)) return invalid();
  return result;
};
const limit = (): never => {
  throw new MarketplaceProviderError(
    "limit",
    "Слишком много поставок Ozon для одной загрузки.",
  );
};

/** Read-only document evidence. Analytics transit remains the sole numerical inbound source. */
export async function ozonSupplies(
  request: Request,
  products: Map<string, MarketplaceProduct>,
): Promise<MarketplaceSupply[]> {
  const orderIds: string[] = [];
  const seenOrders = new Set<string>(),
    cursors = new Set<string>();
  let lastId = "";
  for (let page = 0; ; page++) {
    if (page >= 10) return limit();
    const response = object(
      await request("https://api-seller.ozon.ru/v3/supply-order/list", {
        filter: { states: activeStates },
        limit: 100,
        sort_by: "ORDER_CREATION",
        sort_dir: "DESC",
        ...(lastId ? { last_id: lastId } : {}),
      }),
    );
    if (!Array.isArray(response.order_ids)) return invalid();
    for (const value of response.order_ids) {
      const orderId = numericId(value);
      if (seenOrders.has(orderId)) return invalid();
      seenOrders.add(orderId);
      orderIds.push(orderId);
      if (orderIds.length > 100) return limit();
    }
    if (typeof response.last_id !== "string") return invalid();
    if (!response.order_ids.length || !response.last_id) break;
    if (response.last_id === lastId || cursors.has(response.last_id))
      return invalid();
    cursors.add(response.last_id);
    lastId = response.last_id;
  }
  const supplies: MarketplaceSupply[] = [];
  const seenSupplies = new Set<string>(),
    seenBundles = new Set<string>();
  for (let start = 0; start < orderIds.length; start += 50) {
    const batch = orderIds.slice(start, start + 50);
    const response = object(
      await request("https://api-seller.ozon.ru/v3/supply-order/get", {
        order_ids: batch,
      }),
    );
    const returned = new Set<string>();
    for (const order of rows(response.orders)) {
      const orderId = numericId(order.order_id);
      if (!batch.includes(orderId) || returned.has(orderId)) return invalid();
      returned.add(orderId);
      for (const supply of rows(order.supplies)) {
        const supplyId = numericId(supply.supply_id);
        if (seenSupplies.has(supplyId)) return invalid();
        seenSupplies.add(supplyId);
        if (seenSupplies.size > 100) return limit();
        const rawState =
          typeof supply.state === "string" ? supply.state : invalid();
        const knownState = Object.hasOwn(states, rawState);
        const state = knownState
          ? (rawState as keyof typeof states)
          : "UNSPECIFIED";
        const warnings: string[] = [];
        const calculation =
          !knownState || state === "UNSPECIFIED"
            ? "review"
            : planned.has(state) || excluded.has(state)
              ? "excluded"
              : "analytics";
        if (calculation === "review")
          warnings.push(
            "Ozon: статус поставки не определён; количество по документу не используется в плане.",
          );
        if (planned.has(state))
          warnings.push(
            "Ozon: заявка ещё не передана; её количество не прибавляется к товару в пути.",
          );
        const document: MarketplaceSupply = {
          id: supplyId,
          statusCode: state,
          statusLabel: states[state],
          expectedAt: null,
          receivedAt: null,
          updatedAt: null,
          calculation,
          items: [],
          warnings,
        };
        supplies.push(document);
        if (
          supply.bundle_id === undefined ||
          supply.bundle_id === null ||
          supply.bundle_id === ""
        ) {
          if (state !== "DATA_FILLING" && !excluded.has(state))
            return invalid();
          warnings.push("Ozon: состав заявки ещё не задан.");
          continue;
        }
        const bundleId = id(supply.bundle_id);
        if (seenBundles.has(bundleId)) return invalid();
        seenBundles.add(bundleId);
        const seenSkus = new Set<string>(),
          bundleCursors = new Set<string>();
        let bundleCursor = "",
          expectedCount: number | undefined;
        for (let page = 0; ; page++) {
          if (page >= 20) return limit();
          const bundle = object(
            await request("https://api-seller.ozon.ru/v1/supply-order/bundle", {
              bundle_ids: [bundleId],
              limit: 100,
              is_asc: true,
              sort_field: "SKU",
              ...(bundleCursor ? { last_id: bundleCursor } : {}),
            }),
          );
          const total = units(bundle.total_count);
          if (expectedCount !== undefined && total !== expectedCount)
            return invalid();
          expectedCount = total;
          const items = rows(bundle.items);
          for (const item of items) {
            const externalId = numericId(item.sku);
            if (seenSkus.has(externalId)) return invalid();
            seenSkus.add(externalId);
            const quantity = units(item.quantity);
            const name = text(item.name, `Ozon ${externalId}`);
            if (!products.has(externalId))
              products.set(externalId, {
                externalId,
                offerId: text(item.offer_id, externalId),
                name,
                barcodes: [],
              });
            document.items.push({
              externalId,
              name,
              plannedUnits: quantity,
              acceptedUnits: null,
              readyUnits: null,
              pendingUnits: state === "IN_TRANSIT" ? quantity : null,
            });
          }
          if (typeof bundle.has_next !== "boolean") return invalid();
          if (!bundle.has_next) {
            if (seenSkus.size !== expectedCount) return invalid();
            break;
          }
          const next = id(bundle.last_id);
          if (!items.length || next === bundleCursor || bundleCursors.has(next))
            return invalid();
          bundleCursors.add(next);
          bundleCursor = next;
        }
      }
    }
    if (returned.size !== batch.length) return invalid();
  }
  return supplies;
}

export function ozonInbound(
  products: Iterable<MarketplaceProduct>,
  stocks: Iterable<MarketplaceStock>,
  supplies: MarketplaceSupply[],
): MarketplaceInbound[] {
  const byProduct = new Map<string, MarketplaceStock[]>();
  for (const stock of stocks) {
    const current = byProduct.get(stock.externalId) ?? [];
    current.push(stock);
    byProduct.set(stock.externalId, current);
  }
  return [...products].map((product) => {
    const current = byProduct.get(product.externalId) ?? [];
    const known =
      current.length > 0 &&
      current.every((stock) => stock.inboundUnits !== null);
    const quantity = known
      ? current.reduce((sum, stock) => sum + stock.inboundUnits!, 0)
      : null;
    if (quantity !== null && !Number.isSafeInteger(quantity)) return invalid();
    return {
      externalId: product.externalId,
      units: quantity,
      source: "ozon_analytics",
      supplyIds: supplies
        .filter((supply) =>
          supply.items.some((item) => item.externalId === product.externalId),
        )
        .map((supply) => supply.id),
      warnings:
        quantity === null
          ? [
              "Ozon: API не подтвердил количество в пути для этого товара; отсутствие строки не означает ноль.",
            ]
          : [],
    };
  });
}
