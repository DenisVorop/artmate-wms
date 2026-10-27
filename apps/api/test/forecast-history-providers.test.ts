import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchOzonHistoryPage,
  fetchWbFinanceHistoryPage,
  fetchWbSellerId,
} from "../src/forecasting/history-providers";
import type { HistoryJob } from "../src/forecasting/history-types";
const job: HistoryJob = {
  id: "job",
  provider: "ozon",
  storeId: "store",
  connectionVersion: 1,
  from: "2024-01-01",
  to: "2024-01-31",
  monthFrom: "2024-01-01",
  monthTo: "2024-01-31",
  cursor: "",
  seenCursors: [],
  pages: 0,
  status: "queued",
  leaseId: null,
  leaseUntil: null,
  retryAt: null,
  message: "",
  createdAt: "",
  updatedAt: "",
};
test("Ozon archive preserves a real order date outside its retrieval month", async () => {
  const page = await fetchOzonHistoryPage(
    { apiKey: "fixture", clientId: "1" },
    {
      ...job,
      to: "2024-02-29",
      monthFrom: "2024-02-01",
      monthTo: "2024-02-29",
    },
    {
      fetch: async () =>
        Response.json({
          postings: [
            {
              posting_number: "cross-month",
              created_at: "2024-01-29T12:00:00Z",
              status: "delivered",
              products: [{ sku: 123, quantity: 2 }],
            },
          ],
          has_next: false,
        }),
    },
  );
  assert.equal(page.facts.length, 2);
  assert.equal(page.facts[0].date, "2024-01-29");
  assert.equal(page.facts[0].units, 2);
  assert.equal(page.cursor, null);
});
test("Ozon history uses minimal100itemFBO page, Moscow boundaries, stable line identities and current cancellations", async () => {
  let requestBody: any;
  const options = {
    fetch: async (url: any, init: any) => {
      assert.equal(url, "https://api-seller.ozon.ru/v3/posting/fbo/list");
      requestBody = JSON.parse(init.body);
      return Response.json({
        postings: [
          {
            posting_number: "posting1",
            created_at: "2023-12-31T22:00:00Z",
            status: "cancelled",
            products: [{ sku: 123, quantity: 2 }],
            customer: { name: "must-not-be-kept" },
          },
          {
            posting_number: "external",
            created_at: "2024-01-02T00:00:00Z",
            status: "delivered",
            external_order: { is_external: true },
            products: [{ sku: 456, quantity: 99 }],
          },
        ],
        has_next: true,
        cursor: "next",
      });
    },
  };
  const first = await fetchOzonHistoryPage(
    { apiKey: "fixture", clientId: "1" },
    job,
    options,
  );
  assert.equal(requestBody.limit, 100);
  assert.equal(requestBody.filter.since, "2023-12-31T21:00:00.000Z");
  assert.equal(requestBody.filter.to, "2024-01-31T20:59:59.999Z");
  assert.deepEqual(requestBody.with, {
    analytics_data: false,
    financial_data: false,
    legal_info: false,
  });
  assert.equal(first.facts.length, 2);
  assert.equal(first.facts[0].date, "2024-01-01");
  assert.equal(first.facts[1].units, 2);
  assert.equal(JSON.stringify(first).includes("must-not-be-kept"), false);
  assert.deepEqual(
    await fetchOzonHistoryPage(
      { apiKey: "fixture", clientId: "1" },
      job,
      options,
    ),
    first,
  );
  await assert.rejects(
    fetchOzonHistoryPage(
      { apiKey: "fixture", clientId: "1" },
      { ...job, cursor: "next" },
      options,
    ),
  );
});
test("Finance history chooses weekly source, stores only sales/returns, retains sale dates outside report month and stops at204", async () => {
  let body: any;
  const result = await fetchWbFinanceHistoryPage(
    { apiKey: "finance" },
    { ...job, provider: "wildberries" },
    {
      fetch: async (url: any, init: any) => {
        assert.equal(
          url,
          "https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed",
        );
        body = JSON.parse(init.body);
        return Response.json([
          {
            rrdId: 1,
            nmId: 123,
            docTypeName: "Продажа",
            sellerOperName: "Продажа",
            quantity: 2,
            saleDt: "2023-12-30T00:00:00Z",
            buyerName: "private-buyer",
          },
          {
            rrdId: 2,
            nmId: 123,
            docTypeName: "Возврат",
            sellerOperName: "Возврат",
            quantity: 1,
            saleDt: "2024-01-01T00:00:00Z",
          },
          {
            rrdId: 3,
            nmId: 123,
            docTypeName: "Продажа",
            sellerOperName: "Логистика",
            quantity: 99,
            saleDt: "2024-01-01T00:00:00Z",
          },
        ]);
      },
    },
  );
  assert.equal(body.period, "weekly");
  assert.ok(body.fields.includes("rrDate"));
  assert.equal(result.facts.length, 2);
  assert.equal(result.facts[0].date, "2023-12-30");
  assert.equal(result.facts[0].metric, "sold");
  assert.equal(result.facts[1].metric, "returned");
  assert.equal(result.cursor, "3");
  assert.equal(JSON.stringify(result).includes("private-buyer"), false);
  assert.deepEqual(
    await fetchWbFinanceHistoryPage(
      { apiKey: "finance" },
      { ...job, provider: "wildberries" },
      { fetch: async () => new Response(null, { status: 204 }) },
    ),
    { facts: [], cursor: null },
  );
});
test("history adapters reject malformed pages and repeated cursors instead of publishing a partial month", async () => {
  await assert.rejects(
    fetchWbFinanceHistoryPage(
      { apiKey: "fixture" },
      { ...job, provider: "wildberries", cursor: "5" },
      { fetch: async () => Response.json([]) },
    ),
    { code: "invalid_response" },
  );
  await assert.rejects(
    fetchOzonHistoryPage({ apiKey: "fixture", clientId: "1" }, job, {
      fetch: async () =>
        Response.json({
          postings: [
            {
              posting_number: "order",
              created_at: "2024-01-01T00:00:00Z",
              status: "delivered",
              products: [{ sku: 1, quantity: -2 }],
            },
          ],
          has_next: false,
        }),
    }),
  );
  await assert.rejects(
    fetchWbFinanceHistoryPage(
      { apiKey: "fixture" },
      { ...job, provider: "wildberries", cursor: "5" },
      {
        fetch: async () =>
          Response.json([
            {
              rrdId: 5,
              nmId: 1,
              docTypeName: "Продажа",
              sellerOperName: "Продажа",
              quantity: 1,
              saleDt: "2024-01-01T00:00:00Z",
            },
          ]),
      },
    ),
  );
});

test("seller identity retains only normalized stable SID and rejects missing identity", async () => {
  const sid = await fetchWbSellerId(
    { apiKey: "fixture" },
    {
      fetch: async (url, init) => {
        assert.equal(
          url,
          "https://common-api.wildberries.ru/api/v1/seller-info",
        );
        assert.equal(init?.method, "GET");
        return Response.json({
          sid: "ABCDEF12-1234-1234-1234-123456789ABC",
          name: "private-name",
          tin: "private-tax-id",
          tradeMark: "private-brand",
        });
      },
    },
  );
  assert.equal(sid, "abcdef12-1234-1234-1234-123456789abc");
  await assert.rejects(
    fetchWbSellerId(
      { apiKey: "fixture" },
      { fetch: async () => Response.json({ name: "private-name" }) },
    ),
  );
});
