import assert from "node:assert/strict";
import test from "node:test";
import {
  ozonInbound,
  ozonSupplies,
} from "../src/marketplaces/providers/ozon-supplies";
import { MarketplaceProviderError } from "../src/marketplaces/providers/http";
import type {
  MarketplaceProduct,
  MarketplaceStock,
} from "../src/marketplaces/providers/types";
const product = (externalId = "501"): MarketplaceProduct => ({
  externalId,
  name: "Котики",
  barcodes: [],
});
const stock = (
  inboundUnits: number | null,
  externalId = "501",
  warehouseId = "1",
): MarketplaceStock => ({
  externalId,
  warehouseId,
  warehouseName: "Москва",
  availableUnits: 2,
  reservedUnits: null,
  inboundUnits,
});
const invalid = (error: unknown) =>
  error instanceof MarketplaceProviderError &&
  error.code === "invalid_response";
const fake =
  (
    overrides: Record<string, unknown> = {},
    callback?: (path: string, body: Record<string, unknown>) => void,
  ) =>
  async (url: string, body?: unknown) => {
    const path = new URL(url).pathname;
    callback?.(path, body as Record<string, unknown>);
    if (Object.hasOwn(overrides, path)) return overrides[path];
    if (path.endsWith("/list")) return { order_ids: ["1001"], last_id: "" };
    if (path.endsWith("/get"))
      return {
        orders: [
          {
            order_id: "1001",
            state: "DATA_FILLING",
            supplies: [
              { supply_id: "2001", state: "IN_TRANSIT", bundle_id: "bundle-1" },
            ],
          },
        ],
      };
    if (path.endsWith("/bundle"))
      return {
        items: [{ sku: 501, name: "Котики", quantity: 50 }],
        total_count: 1,
        has_next: false,
        last_id: "",
      };
    assert.fail("Unexpected fixture endpoint");
  };

test("Ozon empty active supply list is explicit empty evidence; known analytics zero differs from missing data", async () => {
  const documents = await ozonSupplies(
    fake({ "/v3/supply-order/list": { order_ids: [], last_id: "" } }),
    new Map(),
  );
  assert.deepEqual(documents, []);
  assert.equal(ozonInbound([product()], [stock(0)], documents)[0]!.units, 0);
  assert.equal(ozonInbound([product()], [], documents)[0]!.units, null);
  assert.equal(
    ozonInbound([product()], [stock(null)], documents)[0]!.units,
    null,
  );
});

test("Ozon nested supply state is authoritative and documents do not double count analytics transit", async () => {
  const products = new Map([["501", product()]]);
  const documents = await ozonSupplies(
    fake({}, (path, body) => {
      if (path.endsWith("/list")) {
        assert.ok(Array.isArray((body.filter as { states: unknown }).states));
        assert.equal(body.sort_by, "ORDER_CREATION");
      }
      if (path.endsWith("/get")) assert.deepEqual(body.order_ids, ["1001"]);
      if (path.endsWith("/bundle")) {
        assert.deepEqual(body.bundle_ids, ["bundle-1"]);
        assert.equal(body.supply_id, undefined);
      }
    }),
    products,
  );
  assert.equal(documents[0]!.statusCode, "IN_TRANSIT");
  assert.equal(documents[0]!.calculation, "analytics");
  assert.equal(documents[0]!.items[0]!.pendingUnits, 50);
  assert.deepEqual(
    ozonInbound(products.values(), [stock(5), stock(7, "501", "2")], documents),
    [
      {
        externalId: "501",
        units: 12,
        source: "ozon_analytics",
        supplyIds: ["2001"],
        warnings: [],
      },
    ],
  );
  assert.equal(
    ozonInbound(
      products.values(),
      [stock(5), stock(null, "501", "2")],
      documents,
    )[0]!.units,
    null,
  );
});

test("Ozon planned, terminal, receiving and unknown supply states remain separate from actual inbound", async () => {
  for (const [state, calculation] of [
    ["DATA_FILLING", "excluded"],
    ["READY_TO_SUPPLY", "excluded"],
    ["CANCELLED", "excluded"],
    ["COMPLETED", "excluded"],
    ["ACCEPTANCE_AT_STORAGE_WAREHOUSE", "analytics"],
    ["REPORTS_CONFIRMATION_AWAITING", "analytics"],
    ["NEW_FUTURE_STATE", "review"],
  ]) {
    const docs = await ozonSupplies(
      fake({
        "/v3/supply-order/get": {
          orders: [
            {
              order_id: "1001",
              supplies: [{ supply_id: "2001", state, bundle_id: "bundle-1" }],
            },
          ],
        },
      }),
      new Map(),
    );
    assert.equal(docs[0]!.calculation, calculation);
    assert.equal(docs[0]!.items[0]!.pendingUnits, null);
    assert.equal(ozonInbound([product()], [stock(3)], docs)[0]!.units, 3);
  }
});

test("Ozon missing composition is allowed only for filling or excluded documents", async () => {
  const get = (state: string) =>
    fake({
      "/v3/supply-order/get": {
        orders: [
          { order_id: "1001", supplies: [{ supply_id: "2001", state }] },
        ],
      },
    });
  assert.equal(
    (await ozonSupplies(get("DATA_FILLING"), new Map()))[0]!.items.length,
    0,
  );
  await assert.rejects(ozonSupplies(get("IN_TRANSIT"), new Map()), invalid);
});

test("Ozon bundle cursor pagination retains all products, including previously unknown SKU for explicit mapping", async () => {
  let page = 0;
  const base = fake();
  const products = new Map<string, MarketplaceProduct>();
  const docs = await ozonSupplies(async (url, body) => {
    if (!url.endsWith("/bundle")) return base(url, body);
    page++;
    assert.equal(
      (body as Record<string, unknown>).last_id,
      page === 1 ? undefined : "next",
    );
    return {
      items: [
        {
          sku: page === 1 ? "501" : "502",
          quantity: page,
          name: `Товар ${page}`,
        },
      ],
      total_count: 2,
      has_next: page === 1,
      last_id: page === 1 ? "next" : "",
    };
  }, products);
  assert.equal(docs[0]!.items.length, 2);
  assert.deepEqual([...products.keys()], ["501", "502"]);
  assert.equal(
    ozonInbound(products.values(), [stock(0)], docs)[1]!.units,
    null,
  );
});

test("Ozon rejects duplicate IDs, incomplete details and ambiguous bundle composition", async () => {
  const cases = [
    { "/v3/supply-order/list": { order_ids: ["1001", "1001"], last_id: "" } },
    { "/v3/supply-order/get": { orders: [] } },
    {
      "/v3/supply-order/get": { orders: [{ order_id: "9999", supplies: [] }] },
    },
    {
      "/v3/supply-order/get": {
        orders: [
          {
            order_id: "1001",
            supplies: [
              { supply_id: "2001", state: "IN_TRANSIT", bundle_id: "same" },
              { supply_id: "2002", state: "IN_TRANSIT", bundle_id: "same" },
            ],
          },
        ],
      },
    },
    {
      "/v3/supply-order/get": {
        orders: [
          {
            order_id: "1001",
            supplies: [
              { supply_id: "2001", state: "IN_TRANSIT", bundle_id: "b1" },
              { supply_id: "2001", state: "IN_TRANSIT", bundle_id: "b2" },
            ],
          },
        ],
      },
    },
    {
      "/v1/supply-order/bundle": {
        items: [
          { sku: 501, quantity: 1 },
          { sku: 501, quantity: 1 },
        ],
        total_count: 2,
        has_next: false,
      },
    },
    {
      "/v1/supply-order/bundle": {
        items: [{ sku: 501, quantity: 1 }],
        total_count: 2,
        has_next: false,
      },
    },
    {
      "/v1/supply-order/bundle": {
        items: [{ sku: 501 }],
        total_count: 1,
        has_next: false,
      },
    },
    {
      "/v1/supply-order/bundle": {
        items: [],
        total_count: 1,
        has_next: true,
        last_id: "next",
      },
    },
  ];
  for (const fixture of cases)
    await assert.rejects(ozonSupplies(fake(fixture), new Map()), invalid);
});

test("Ozon repeated list/bundle cursors and changing totals cannot publish partial documents", async () => {
  let lists = 0;
  await assert.rejects(
    ozonSupplies(async (url) => {
      assert.ok(url.endsWith("/list"));
      return { order_ids: [String(++lists)], last_id: "stalled" };
    }, new Map()),
    invalid,
  );
  for (const mode of ["cursor", "total"]) {
    let bundles = 0;
    const base = fake();
    await assert.rejects(
      ozonSupplies(async (url, body) => {
        if (!url.endsWith("/bundle")) return base(url, body);
        bundles++;
        return {
          items: [{ sku: String(500 + bundles), quantity: 1 }],
          total_count: mode === "total" ? bundles : 3,
          has_next: true,
          last_id: "stalled",
        };
      }, new Map()),
      invalid,
    );
  }
});

test("Ozon active document bounds reject the whole import and integer overflow cannot become a quantity", async () => {
  await assert.rejects(
    ozonSupplies(
      fake({
        "/v3/supply-order/get": {
          orders: [
            {
              order_id: "1001",
              supplies: Array.from({ length: 101 }, (_, i) => ({
                supply_id: String(i + 1),
                state: "DATA_FILLING",
              })),
            },
          ],
        },
      }),
      new Map(),
    ),
    (e: unknown) => e instanceof MarketplaceProviderError && e.code === "limit",
  );
  assert.throws(
    () =>
      ozonInbound(
        [product()],
        [stock(Number.MAX_SAFE_INTEGER), stock(1, "501", "2")],
        [],
      ),
    invalid,
  );
});

test("Ozon snapshot publishes documents with per-SKU analytics and unknown bundle-only products", async () => {
  const { ozon } = await import("../src/marketplaces/providers/ozon");
  let catalog = 0;
  const result = await ozon(
    { apiKey: "fixture-only", clientId: "123" },
    { from: "2026-10-24", to: "2026-10-24" },
    {
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        assert.equal(init?.redirect, "error");
        assert.ok(init?.signal);
        const url = String(input),
          path = new URL(url).pathname;
        let response: unknown;
        if (path === "/v3/product/list")
          response = {
            result: {
              items: ++catalog === 1 ? [{ product_id: 90 }] : [],
              last_id: catalog === 1 ? "next" : "",
            },
          };
        else if (path === "/v3/product/info/list")
          response = {
            items: [{ id: 90, sku: 501, name: "Котики", barcodes: [] }],
          };
        else if (path === "/v1/analytics/stocks")
          response = {
            items: [
              {
                sku: 501,
                warehouse_id: 1,
                available_stock_count: 3,
                transit_stock_count: 4,
              },
            ],
          };
        else if (path === "/v3/posting/fbo/list")
          response = { postings: [], has_next: false };
        else
          response = await fake({
            "/v1/supply-order/bundle": {
              items: [{ sku: 502, name: "Новая тематика", quantity: 20 }],
              total_count: 1,
              has_next: false,
            },
          })(url, init?.body ? JSON.parse(String(init.body)) : undefined);
        return new Response(JSON.stringify(response), { status: 200 });
      }) as typeof fetch,
    },
  );
  assert.equal(result.supplies?.length, 1);
  assert.equal(result.products.length, 2);
  assert.equal(
    result.inbound?.find((row) => row.externalId === "501")?.units,
    4,
  );
  assert.equal(
    result.inbound?.find((row) => row.externalId === "502")?.units,
    null,
  );
  assert.equal(
    result.stocks.find((row) => row.externalId === "502")?.availableUnits,
    null,
  );
  assert.equal(result.coverage.inbound, false);
});

test("Ozon imports 83 open documents within the shared request budget", async () => {
  let bundleRequests = 0;
  const docs = await ozonSupplies(async (url) => {
    if (url.endsWith("/list")) return { order_ids: ["1001"], last_id: "" };
    if (url.endsWith("/get"))
      return {
        orders: [
          {
            order_id: "1001",
            supplies: Array.from({ length: 83 }, (_, i) => ({
              supply_id: String(2000 + i),
              state: "READY_TO_SUPPLY",
              bundle_id: `bundle-${i}`,
            })),
          },
        ],
      };
    assert.ok(url.endsWith("/bundle"));
    bundleRequests++;
    return {
      items: [{ sku: "501", quantity: 20, name: "Котики" }],
      total_count: 1,
      has_next: false,
    };
  }, new Map());
  assert.equal(docs.length, 83);
  assert.equal(bundleRequests, 83);
  assert.ok(docs.every((doc) => doc.calculation === "excluded"));
});
