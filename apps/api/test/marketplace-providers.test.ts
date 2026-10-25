import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchMarketplaceSnapshot,
  MarketplaceProviderError,
} from "../src/marketplaces/providers";
const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const day = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
const period = { from: day, to: day };
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200 });
const options = (
  handler: (
    url: URL,
    body: Record<string, unknown>,
    init: RequestInit,
  ) => Response,
) => ({
  fetch: (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return handler(
      new URL(String(input)),
      init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {},
      init!,
    );
  }) as typeof fetch,
});
const wbOrder = (srid: string, fields: Record<string, unknown> = {}) => ({
  srid,
  date: `${day}T08:00:00`,
  lastChangeDate: `${day}T08:01:00`,
  warehouseType: "Склад WB",
  nmId: 101,
  isCancel: false,
  ...fields,
});

test("WB current stocks, FBS exclusion, pagination dedup and consumer transit never becomes inbound", async () => {
  let orders = 0,
    sales = 0;
  const result = await fetchMarketplaceSnapshot(
    "wildberries",
    { apiKey: "fixture" },
    period,
    options((url, body, init) => {
      assert.equal(
        (init.headers as Record<string, string>).Authorization,
        "fixture",
      );
      if (url.pathname.includes("/cards/"))
        return json({
          cards: [
            {
              nmID: 101,
              vendorCode: "cats",
              title: "Котики",
              sizes: [{ skus: ["barcode-1"] }],
            },
          ],
          cursor: { total: 1 },
        });
      if (url.pathname.endsWith("/wb-warehouses")) {
        assert.deepEqual(body, { nmIds: [], limit: 10000, offset: 0 });
        return json({
          data: {
            items: [
              {
                nmId: 101,
                chrtId: 1,
                warehouseId: -999999,
                warehouseName: "Склад WB",
                quantity: 12,
                inWayToClient: 900,
                inWayFromClient: 800,
              },
            ],
          },
        });
      }
      if (url.pathname.endsWith("/orders")) {
        orders++;
        if (orders === 1)
          return json([
            wbOrder("a"),
            wbOrder("fbs", { warehouseType: "Склад продавца" }),
          ]);
        if (orders === 2)
          return json([
            wbOrder("a"),
            wbOrder("b", { isCancel: true, lastChangeDate: `${day}T09:00:00` }),
          ]);
        return json([]);
      }
      if (url.pathname.endsWith("/sales"))
        return json(
          ++sales === 1
            ? [wbOrder("s", { saleID: "S1" }), wbOrder("r", { saleID: "R1" })]
            : [],
        );
      assert.fail("Unexpected fixture endpoint");
    }),
  );
  assert.equal(orders, 3);
  assert.equal(sales, 2);
  assert.equal(result.products[0]!.name, "Котики");
  assert.equal(result.stocks[0]!.availableUnits, 12);
  assert.equal(result.stocks[0]!.inboundUnits, null);
  assert.equal(result.stocks[0]!.reservedUnits, null);
  assert.equal(result.coverage.inbound, false);
  assert.deepEqual(result.demand, [
    {
      externalId: "101",
      date: day,
      orderedUnits: 2,
      cancelledUnits: 1,
      returnedUnits: 1,
      soldUnits: 1,
    },
  ]);
});

test("Ozon current FBO cursor endpoint, SKU identity, Moscow dates, available/transit only", async () => {
  let catalog = 0,
    postings = 0;
  const result = await fetchMarketplaceSnapshot(
    "ozon",
    { apiKey: "fixture", clientId: "123" },
    period,
    options((url, body, init) => {
      assert.equal(
        (init.headers as Record<string, string>)["Client-Id"],
        "123",
      );
      if (url.pathname === "/v3/product/list")
        return json({
          result: {
            items: ++catalog === 1 ? [{ product_id: 90, sku: 501 }] : [],
            last_id: catalog === 1 ? "next" : "",
          },
        });
      if (url.pathname === "/v3/product/info/list") {
        assert.deepEqual(body.product_id, ["90"]);
        return json({
          items: [
            {
              id: 90,
              sku: 501,
              offer_id: "cats",
              name: "Котики",
              barcodes: ["001"],
            },
          ],
        });
      }
      if (url.pathname === "/v1/analytics/stocks")
        return json({
          items: [
            {
              sku: 501,
              warehouse_id: 10,
              warehouse_name: "Москва",
              available_stock_count: 9,
              transit_stock_count: 5,
              requested_stock_count: 100,
              inbound_replenishment: 900,
              outbound_pending_delivery: 77,
            },
          ],
        });
      if (url.pathname === "/v3/posting/fbo/list") {
        postings++;
        assert.equal(
          (body.filter as Record<string, unknown>).since,
          new Date(`${day}T00:00:00+03:00`).toISOString(),
        );
        assert.equal(body.cursor, postings === 1 ? "" : "second");
        return json({
          cursor: postings === 1 ? "second" : "",
          has_next: postings === 1,
          postings: [
            {
              posting_number: `p${postings}`,
              created_at: `${day}T00:01:00+03:00`,
              status: postings === 1 ? "delivered" : "cancelled",
              products: [{ sku: 501, quantity: postings === 1 ? 3 : 2 }],
            },
          ],
        });
      }
      assert.fail("Unexpected fixture endpoint");
    }),
  );
  assert.equal(result.products[0]!.externalId, "501");
  assert.equal(result.stocks[0]!.availableUnits, 9);
  assert.equal(result.stocks[0]!.inboundUnits, 5);
  assert.equal(result.coverage.inbound, true);
  assert.deepEqual(result.demand, [
    {
      externalId: "501",
      date: day,
      orderedUnits: 5,
      cancelledUnits: 2,
      returnedUnits: 0,
      soldUnits: null,
    },
  ]);
});

test("safe errors never expose key, upstream body or fetch exception", async () => {
  for (const status of [401, 403, 429, 500])
    await assert.rejects(
      fetchMarketplaceSnapshot(
        "ozon",
        { apiKey: "SECRET", clientId: "123" },
        period,
        {
          fetch: (async () =>
            new Response("SECRET private error", { status })) as typeof fetch,
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof MarketplaceProviderError);
        assert.ok(!error.message.includes("SECRET"));
        assert.equal(
          error.code,
          status === 429
            ? "rate_limit"
            : status === 500
              ? "unavailable"
              : "credentials",
        );
        return true;
      },
    );
  await assert.rejects(
    fetchMarketplaceSnapshot(
      "ozon",
      { apiKey: "SECRET", clientId: "123" },
      period,
      {
        fetch: (async () => {
          throw new Error("SECRET");
        }) as typeof fetch,
      },
    ),
    /Маркетплейс недоступен/,
  );
});
test("WB stalled pagination rejects partial snapshot", async () => {
  await assert.rejects(
    fetchMarketplaceSnapshot(
      "wildberries",
      { apiKey: "fixture" },
      period,
      options((url) =>
        url.pathname.includes("/cards/")
          ? json({ cards: [], cursor: { total: 0 } })
          : url.pathname.endsWith("/wb-warehouses")
            ? json({ data: { items: [] } })
            : json([wbOrder("a")]),
      ),
    ),
    (error: unknown) =>
      error instanceof MarketplaceProviderError &&
      error.code === "invalid_response",
  );
});
test("missing quantity fails instead of claiming zero stock", async () => {
  await assert.rejects(
    fetchMarketplaceSnapshot(
      "wildberries",
      { apiKey: "fixture" },
      period,
      options((url) =>
        url.pathname.includes("/cards/")
          ? json({ cards: [], cursor: { total: 0 } })
          : json({ data: { items: [{ nmId: 101, warehouseId: 1 }] } }),
      ),
    ),
    (error: unknown) =>
      error instanceof MarketplaceProviderError &&
      error.code === "invalid_response",
  );
});
test("invalid dates, current day, long history or header injection never make requests", async () => {
  let calls = 0;
  const fake = {
    fetch: (async () => {
      calls++;
      return json({});
    }) as typeof fetch,
  };
  for (const p of [
    { from: "2026-02-30", to: "2026-02-30" },
    { from: today, to: today },
    { from: "2026-01-01", to: "2026-05-01" },
  ])
    await assert.rejects(
      fetchMarketplaceSnapshot("ozon", { apiKey: "x", clientId: "1" }, p, fake),
    );
  await assert.rejects(
    fetchMarketplaceSnapshot(
      "ozon",
      { apiKey: "x\r\nsecret", clientId: "1" },
      period,
      fake,
    ),
  );
  assert.equal(calls, 0);
});

test("missing Ozon stock is explicit unknown, never a synthetic zero", async () => {
  let catalog = 0;
  const result = await fetchMarketplaceSnapshot(
    "ozon",
    { apiKey: "fixture", clientId: "123" },
    period,
    options((url) => {
      if (url.pathname === "/v3/product/list")
        return json({
          result: {
            items: ++catalog === 1 ? [{ product_id: 90 }] : [],
            last_id: catalog === 1 ? "next" : "",
          },
        });
      if (url.pathname === "/v3/product/info/list")
        return json({
          items: [{ id: 90, sku: 501, name: "Котики", barcodes: [] }],
        });
      if (url.pathname === "/v1/analytics/stocks") return json({ items: [] });
      return json({ postings: [], has_next: false, cursor: "" });
    }),
  );
  assert.equal(result.stocks.length, 1);
  assert.equal(result.stocks[0]!.availableUnits, null);
  assert.equal(result.stocks[0]!.inboundUnits, null);
  assert.equal(result.coverage.inbound, false);
});
test("already aborted synchronization never makes a request", async () => {
  let calls = 0;
  await assert.rejects(
    fetchMarketplaceSnapshot(
      "ozon",
      { apiKey: "fixture", clientId: "123" },
      period,
      {
        signal: AbortSignal.abort(),
        fetch: (async () => {
          calls++;
          return json({});
        }) as typeof fetch,
      },
    ),
    (error: unknown) =>
      error instanceof MarketplaceProviderError && error.code === "aborted",
  );
  assert.equal(calls, 0);
});
