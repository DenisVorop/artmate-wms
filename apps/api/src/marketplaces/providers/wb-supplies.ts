import { invalid, MarketplaceProviderError, rows, text } from "./http";
import type {
  MarketplaceInbound,
  MarketplaceProduct,
  MarketplaceSupply,
  MarketplaceSupplyItem,
} from "./types";

type Request = (url: string, body?: unknown) => Promise<unknown>;
const origin = "https://supplies-api.wildberries.ru/api/v1/supplies";
const labels: Record<number, string> = {
  2: "Запланирована",
  3: "Разрешена отгрузка",
  4: "Идёт приёмка",
  5: "Принята",
  6: "Отгружена на воротах",
};
const counter = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
const numericId = (value: unknown): string => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    return String(value);
  if (typeof value === "string" && /^[1-9]\d{0,19}$/.test(value)) return value;
  return invalid();
};
// WB date-times without timezone are Moscow local time, as in its other APIs.
const date = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value))
    return null;
  const calendarDay = value.slice(0, 10);
  const calendarTime = Date.parse(`${calendarDay}T00:00:00Z`);
  if (
    !Number.isFinite(calendarTime) ||
    new Date(calendarTime).toISOString().slice(0, 10) !== calendarDay
  )
    return null;
  const input = value.length === 10 ? `${value}T00:00:00+03:00` : value;
  const parsed = Date.parse(
    /[zZ]$|[+-]\d\d:\d\d$/.test(input) ? input : `${input}+03:00`,
  );
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};
const add = (a: number, b: number): number => {
  const result = a + b;
  if (!Number.isSafeInteger(result)) return invalid();
  return result;
};
const sumNullable = (a: number | null, b: number | null) =>
  a === null || b === null ? null : add(a, b);
const warning = {
  planned:
    "Плановая поставка ещё не передана WB и не уменьшает потребность в сборке.",
  estimate:
    "Приёмка не завершена: ожидаемый остаток рассчитан по заявленному количеству; возможны расхождения.",
  counts:
    "В поставке отсутствуют или некорректны счётчики товара; остаток требует проверки.",
  stale:
    "Переданная поставка старше 30 дней либо дата передачи неизвестна; остаток требует проверки.",
  fallback:
    "Дата фактической передачи отсутствует: давность проверена по плановой дате или дате создания.",
  date: "Некорректная дата поставки; остаток требует проверки.",
};

/** Sanitizes supply documents and resolves inbound per nmID. No upstream payload is retained. */
export async function wbSupplies(
  request: Request,
  products: Map<string, MarketplaceProduct>,
  asOf: string,
): Promise<{ inbound: MarketplaceInbound[]; supplies: MarketplaceSupply[] }> {
  const inbound = new Map<string, MarketplaceInbound>();
  const ensure = (externalId: string) => {
    if (!inbound.has(externalId))
      inbound.set(externalId, {
        externalId,
        units: 0,
        source: "wb_supplies",
        supplyIds: [],
        warnings: [],
      });
    return inbound.get(externalId)!;
  };
  for (const externalId of products.keys()) ensure(externalId);
  const supplies: MarketplaceSupply[] = [];
  const documentIds = new Set<string>();
  const barcodeProducts = new Map<string, string>();
  for (const product of products.values())
    for (const barcode of product.barcodes) {
      const previousProduct = barcodeProducts.get(barcode);
      if (previousProduct && previousProduct !== product.externalId)
        return invalid();
      barcodeProducts.set(barcode, product.externalId);
    }
  const preorderIds = new Set<string>();
  const now = Date.parse(asOf);
  if (!Number.isFinite(now)) return invalid();
  const filters = [
    { statusIDs: [2, 3, 4, 6] },
    {
      statusIDs: [5],
      dates: [
        {
          // WB accepts calendar dates; include the current Moscow day completely.
          from: new Date(now - 30 * 86_400_000 + 3 * 3_600_000)
            .toISOString()
            .slice(0, 10),
          till: new Date(now + 86_400_000 + 3 * 3_600_000)
            .toISOString()
            .slice(0, 10),
          type: "updatedDate",
        },
      ],
    },
  ];
  for (const filter of filters) {
    for (let offset = 0; ; offset += 1000) {
      if (offset >= 10_000)
        throw new MarketplaceProviderError(
          "limit",
          "Поставки WB превысили размер одной загрузки.",
        );
      const batch = rows(
        await request(`${origin}?limit=1000&offset=${offset}`, filter),
      );
      for (const row of batch) {
        const status = counter(row.statusID);
        if (
          status === null ||
          !labels[status] ||
          !filter.statusIDs.includes(status)
        )
          return invalid();
        const preorder = row.supplyID === null || row.supplyID === undefined;
        const rawId = numericId(preorder ? row.preorderID : row.supplyID);
        const supplyId = `${preorder ? "preorder" : "supply"}:${rawId}`;
        if (documentIds.has(supplyId)) return invalid();
        documentIds.add(supplyId);
        if (row.preorderID !== null && row.preorderID !== undefined) {
          const preorderId = numericId(row.preorderID);
          if (preorderIds.has(preorderId)) return invalid();
          preorderIds.add(preorderId);
        }
        const planned = status === 2 || status === 3;
        const receivedAt = date(row.factDate);
        const expectedAt = date(row.supplyDate);
        const ageDate = receivedAt ?? expectedAt ?? date(row.createDate);
        const invalidDate = [
          row.factDate,
          row.supplyDate,
          row.createDate,
          row.updatedDate,
        ].some(
          (value) =>
            value !== null && value !== undefined && date(value) === null,
        );
        const stale =
          !planned &&
          status !== 5 &&
          (ageDate === null || now - Date.parse(ageDate) > 30 * 86_400_000);
        const document: MarketplaceSupply = {
          id: supplyId,
          statusCode: String(status),
          statusLabel: labels[status]!,
          expectedAt,
          receivedAt,
          updatedAt: date(row.updatedDate),
          calculation: planned
            ? "excluded"
            : stale || invalidDate
              ? "review"
              : "document",
          items: [],
          warnings: planned
            ? [warning.planned]
            : stale
              ? [warning.stale]
              : status === 5
                ? []
                : [warning.estimate],
        };
        if (!planned && invalidDate) document.warnings.push(warning.date);
        if (!planned && !receivedAt && ageDate && !invalidDate)
          document.warnings.push(warning.fallback);
        const itemMap = new Map<string, MarketplaceSupplyItem>();
        const goodsIds = new Set<string>();
        for (let goodsOffset = 0; ; goodsOffset += 1000) {
          if (goodsOffset >= 100_000)
            throw new MarketplaceProviderError(
              "limit",
              "Товары поставки WB превысили размер одной загрузки.",
            );
          const goods = rows(
            await request(
              `${origin}/${rawId}/goods?limit=1000&offset=${goodsOffset}&isPreorderID=${preorder}`,
            ),
          );
          for (const good of goods) {
            const externalId = numericId(good.nmID);
            const barcode =
              typeof good.barcode === "string" &&
              good.barcode.trim() &&
              good.barcode.length <= 200
                ? good.barcode
                : null;
            if (barcode === null) return invalid();
            const previousProduct = barcodeProducts.get(barcode);
            if (previousProduct && previousProduct !== externalId)
              return invalid();
            barcodeProducts.set(barcode, externalId);
            const identity = `${externalId}:${barcode}`;
            if (goodsIds.has(identity)) return invalid();
            goodsIds.add(identity);
            if (!products.has(externalId))
              products.set(externalId, {
                externalId,
                offerId: text(good.vendorCode, externalId),
                name: text(good.vendorCode, `WB ${externalId}`),
                barcodes: [barcode],
              });
            const currentInbound = ensure(externalId);
            const declared = counter(good.quantity);
            const accepted = counter(good.acceptedQuantity);
            const ready = counter(good.readyForSaleQuantity);
            // Final accepted quantity, not declared quantity, absorbs shortages.
            const basis = status === 5 ? accepted : declared;
            const pending = planned
              ? 0
              : stale || invalidDate || basis === null || ready === null
                ? null
                : Math.max(basis - ready, 0);
            const old = itemMap.get(externalId);
            const item: MarketplaceSupplyItem = {
              externalId,
              name: products.get(externalId)!.name,
              plannedUnits: old
                ? sumNullable(old.plannedUnits, declared)
                : declared,
              acceptedUnits: old
                ? sumNullable(old.acceptedUnits, accepted)
                : accepted,
              readyUnits: old ? sumNullable(old.readyUnits, ready) : ready,
              pendingUnits: old
                ? sumNullable(old.pendingUnits, pending)
                : pending,
            };
            itemMap.set(externalId, item);
            if (!planned) {
              currentInbound.units = sumNullable(currentInbound.units, pending);
              if (pending === null || pending > 0)
                currentInbound.supplyIds.push(supplyId);
              if (pending === null) {
                document.calculation = "review";
                const reason = invalidDate
                  ? warning.date
                  : stale
                    ? warning.stale
                    : warning.counts;
                document.warnings.push(reason);
                currentInbound.warnings.push(reason);
              } else if (status !== 5 && pending > 0) {
                currentInbound.warnings.push(warning.estimate);
              }
              if (!receivedAt && ageDate && !invalidDate)
                currentInbound.warnings.push(warning.fallback);
            }
          }
          if (goods.length < 1000) break;
        }
        document.items = [...itemMap.values()];
        document.warnings = [...new Set(document.warnings)];
        supplies.push(document);
      }
      if (batch.length < 1000) break;
    }
  }
  for (const item of inbound.values()) {
    item.supplyIds = [...new Set(item.supplyIds)];
    item.warnings = [...new Set(item.warnings)];
  }
  return { inbound: [...inbound.values()], supplies };
}
