import {
  client,
  id,
  invalid,
  moscowDate,
  object,
  rows,
  text,
  units,
} from "../marketplaces/providers/http";
import type {
  MarketplaceCredentials,
  MarketplaceFetchOptions,
} from "../marketplaces/providers/types";
import type { HistoryJob, HistoryPage } from "./history-types";
import { historyId } from "./history-storage";
/** One minimal FBO history page. Shared client owns pacing, bounded retries and the allowlisted URL. */
export async function fetchOzonHistoryPage(
  credentials: MarketplaceCredentials,
  job: HistoryJob,
  options: MarketplaceFetchOptions,
): Promise<HistoryPage> {
  const request = client(
    { "Api-Key": credentials.apiKey, "Client-Id": credentials.clientId! },
    options,
  );
  const result = object(
    await request("https://api-seller.ozon.ru/v3/posting/fbo/list", {
      cursor: job.cursor,
      filter: {
        since: new Date(`${job.monthFrom}T00:00:00+03:00`).toISOString(),
        to: new Date(
          Date.parse(`${job.monthTo}T00:00:00+03:00`) + 86400000 - 1,
        ).toISOString(),
      },
      limit: 100,
      sort_dir: "ASC",
      translit: false,
      with: { analytics_data: false, financial_data: false, legal_info: false },
    }),
  );
  const facts: HistoryPage["facts"] = [],
    seen = new Set<string>();
  for (const posting of rows(result.postings)) {
    const postingId = id(posting.posting_number);
    if (seen.has(postingId)) return invalid();
    seen.add(postingId);
    const date = moscowDate(posting.created_at);
    // Ozon may retrieve a February posting whose order was created in January.
    // Keep the real order date; the service records ownership by retrieval window.
    if (date > job.to) return invalid();
    if (
      posting.external_order &&
      object(posting.external_order).is_external === true
    )
      continue;
    const status = text(posting.status, "");
    if (!status) return invalid();
    const skus = new Set<string>();
    for (const p of rows(posting.products)) {
      const externalId = id(p.sku);
      if (skus.has(externalId)) return invalid();
      skus.add(externalId);
      const quantity = units(p.quantity);
      for (const metric of ["ordered", "cancelled"] as const)
        facts.push({
          id: historyId("ozon_fbo", postingId, externalId, metric),
          externalId,
          date,
          metric,
          units:
            metric === "ordered"
              ? quantity
              : status === "cancelled"
                ? quantity
                : 0,
          source: "ozon_fbo",
        });
    }
  }
  if (typeof result.has_next !== "boolean") return invalid();
  const cursor = result.has_next ? id(result.cursor) : null;
  if (cursor && (cursor === job.cursor || job.seenCursors.includes(cursor)))
    return invalid();
  return { facts, cursor };
}

/** Financial sell-through is a separate metric; never substituted for operational orders. */
export async function fetchWbFinanceHistoryPage(
  credentials: MarketplaceCredentials,
  job: HistoryJob,
  options: MarketplaceFetchOptions,
): Promise<HistoryPage> {
  const request = client({ Authorization: credentials.apiKey }, options);
  const raw = await request(
    "https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed",
    {
      dateFrom: job.monthFrom,
      dateTo: job.monthTo,
      limit: 1000,
      rrdId: job.cursor ? Number(job.cursor) : 0,
      period: "weekly",
      fields: [
        "rrdId",
        "nmId",
        "docTypeName",
        "sellerOperName",
        "quantity",
        "saleDt",
        "rrDate",
      ],
    },
  );
  if (raw === null) return { facts: [], cursor: null };
  const items = rows(raw);
  // Only HTTP 204 confirms the end of this financial report. An unexpected
  // empty 200 must not publish an incompletely traversed month.
  if (!items.length) return invalid();
  const facts: HistoryPage["facts"] = [];
  let cursor = job.cursor;
  for (const row of items) {
    const rowId = id(row.rrdId);
    if (
      !/^\d{1,16}$/.test(rowId) ||
      !Number.isSafeInteger(Number(rowId)) ||
      Number(rowId) <= Number(cursor || 0)
    )
      return invalid();
    cursor = rowId;
    const operation = text(row.sellerOperName, "").trim().toLowerCase(),
      document = text(row.docTypeName, "").trim().toLowerCase();
    let metric: "sold" | "returned";
    if (operation === "продажа" && document === "продажа") metric = "sold";
    else if (operation === "возврат" && document === "возврат")
      metric = "returned";
    else continue;
    const date = moscowDate(row.saleDt),
      externalId = id(row.nmId);
    facts.push({
      id: historyId("wb_finance", rowId, metric),
      externalId,
      date,
      metric,
      units: units(row.quantity),
      source: "wb_finance",
    });
  }
  if (cursor === job.cursor || job.seenCursors.includes(cursor))
    return invalid();
  return { facts, cursor };
}

/** Discard seller names/tax IDs immediately; only the stable sid may leave the adapter. */
export async function fetchWbSellerId(
  credentials: MarketplaceCredentials,
  options: MarketplaceFetchOptions,
): Promise<string> {
  const request = client({ Authorization: credentials.apiKey }, options);
  const seller = object(
    await request("https://common-api.wildberries.ru/api/v1/seller-info"),
  );
  if (
    typeof seller.sid !== "string" ||
    !/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(
      seller.sid,
    )
  )
    return invalid();
  return seller.sid.toLowerCase();
}
