import assert from "node:assert/strict";
import test from "node:test";
import {
  client,
  MarketplaceProviderError,
} from "../src/marketplaces/providers/http";
import { wbSupplies } from "../src/marketplaces/providers/wb-supplies";
import type { MarketplaceProduct } from "../src/marketplaces/providers/types";

const now = "2026-10-26T08:00:00.000Z";
const product = (externalId = "101"): MarketplaceProduct => ({
  externalId,
  name: `Theme ${externalId}`,
  barcodes: [],
});
const document = (
  supplyID: number | null,
  statusID: number,
  rest: Record<string, unknown> = {},
) => ({
  supplyID,
  preorderID: supplyID === null ? 999 : supplyID + 100,
  statusID,
  createDate: "2026-10-21T00:00:00",
  supplyDate: "2026-10-25T00:00:00",
  factDate: "2026-10-25T00:00:00",
  updatedDate: "2026-10-25T00:00:00",
  phone: "PRIVATE phone",
  ...rest,
});
const good = (rest: Record<string, unknown> = {}) => ({
  nmID: 101,
  barcode: "460000001",
  vendorCode: "Cats",
  quantity: 100,
  acceptedQuantity: 90,
  readyForSaleQuantity: 40,
  unloadingQuantity: 0,
  phone: "PRIVATE phone",
  ...rest,
});
function fixture(
  documents: Record<string, unknown>[],
  goods: Record<string, Record<string, unknown>[]>,
  products = new Map([["101", product()]]),
) {
  const calls: { url: URL; body?: unknown }[] = [];
  const request = async (url: string, body?: unknown) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, body });
    if (parsed.pathname === "/api/v1/supplies") {
      const offset = Number(parsed.searchParams.get("offset"));
      const filter = body as {
        statusIDs: number[];
        dates?: { from: string; till: string }[];
      };
      const matching = documents.filter(
        (item) =>
          filter.statusIDs.includes(item.statusID as number) &&
          (!filter.dates ||
            (String(item.updatedDate) >= filter.dates[0]!.from.slice(0, 10) &&
              String(item.updatedDate) <= filter.dates[0]!.till)),
      );
      return matching.slice(offset, offset + 1000);
    }
    const key = parsed.pathname.split("/")[4]!;
    const offset = Number(parsed.searchParams.get("offset"));
    return (goods[key] ?? []).slice(offset, offset + 1000);
  };
  return { calls, run: () => wbSupplies(request, products, now), products };
}

test("WB planned/preorder documents are visible without counting undelivered goods", async () => {
  const f = fixture([document(null, 2), document(3, 3)], {
    "999": [good()],
    "3": [good()],
  });
  const result = await f.run();
  assert.equal(result.inbound[0]!.units, 0);
  assert.equal(result.supplies[0]!.calculation, "excluded");
  assert.equal(result.supplies[0]!.items[0]!.plannedUnits, 100);
  assert.equal(f.calls[1]!.url.searchParams.get("isPreorderID"), "true");
  assert.deepEqual(f.calls[0]!.body, { statusIDs: [2, 3, 4, 6] });
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
});

test("WB receiving uses declared-minus-ready estimate, final accepted absorbs shortages", async () => {
  const result = await fixture(
    [document(1, 4), document(2, 5), document(3, 6)],
    {
      "1": [good()],
      "2": [good()],
      "3": [
        good({ quantity: 20, acceptedQuantity: 20, readyForSaleQuantity: 20 }),
      ],
    },
  ).run();
  assert.equal(result.inbound[0]!.units, 110); // 60 expected + 50 accepted, not 120
  assert.deepEqual(result.inbound[0]!.supplyIds, ["supply:1", "supply:2"]);
  assert.equal(result.supplies[0]!.items[0]!.pendingUnits, 60);
  assert.equal(
    result.supplies.find((item) => item.statusCode === "5")!.items[0]!
      .pendingUnits,
    50,
  );
  assert.match(result.inbound[0]!.warnings[0]!, /заявленному/);
});

test("WB stale and missing counters make only the affected product unknown", async () => {
  const products = new Map([
    ["101", product()],
    ["102", product("102")],
    ["103", product("103")],
  ]);
  const result = await fixture(
    [document(1, 6, { factDate: "2026-08-01T00:00:00" }), document(2, 5)],
    {
      "1": [good()],
      "2": [good({ nmID: 102, barcode: "460000002", acceptedQuantity: null })],
    },
    products,
  ).run();
  assert.deepEqual(
    result.inbound.map((entry) => entry.units),
    [null, null, 0],
  );
  assert.ok(result.supplies.every((entry) => entry.calculation === "review"));
  // Old completed documents are final facts, not timed-out unfinished estimates.
  const completed = await fixture(
    [document(1, 5, { factDate: "2026-08-01T00:00:00" })],
    { "1": [good()] },
  ).run();
  assert.equal(completed.inbound[0]!.units, 50);
});

test("WB missing quantities and malformed dates stay unknown only for their SKU", async () => {
  for (const changed of [
    { quantity: null },
    { quantity: -1 },
    { readyForSaleQuantity: null },
    { readyForSaleQuantity: -1 },
  ]) {
    const result = await fixture([document(1, 4)], {
      "1": [good(changed)],
    }).run();
    assert.equal(result.inbound[0]!.units, null);
    assert.equal(result.supplies[0]!.calculation, "review");
  }
  const badDate = await fixture(
    [document(1, 5, { factDate: "PRIVATE invalid" })],
    { "1": [good()] },
  ).run();
  assert.equal(badDate.inbound[0]!.units, null);
  assert.ok(!JSON.stringify(badDate).includes("PRIVATE"));
  const fallback = await fixture([document(1, 4, { factDate: null })], {
    "1": [good()],
  }).run();
  assert.equal(fallback.inbound[0]!.units, 60);
  assert.ok(
    fallback.inbound[0]!.warnings.some((message) =>
      message.includes("отсутствует"),
    ),
  );
});

test("WB empty imports establish known zero, legitimate sizes aggregate once", async () => {
  assert.equal((await fixture([], {}).run()).inbound[0]!.units, 0);
  const f = fixture([document(1, 5)], {
    "1": [
      good(),
      good({
        barcode: "460000002",
        acceptedQuantity: 10,
        readyForSaleQuantity: 0,
      }),
      good({
        nmID: 102,
        barcode: "460000003",
        acceptedQuantity: 3,
        readyForSaleQuantity: 0,
      }),
    ],
  });
  const result = await f.run();
  assert.equal(result.inbound[0]!.units, 60);
  assert.equal(result.supplies[0]!.items[0]!.plannedUnits, 200);
  assert.equal(result.supplies[0]!.items.length, 2);
  assert.equal(result.inbound[1]!.units, 3);
  assert.ok(f.products.has("102"));
});

test("WB duplicate documents, duplicate goods and conflicting barcode identities fail closed", async () => {
  for (const f of [
    fixture([document(1, 5), document(1, 5)], { "1": [good()] }),
    fixture([document(1, 5)], { "1": [good(), good()] }),
    fixture([document(1, 5)], { "1": [good(), good({ nmID: 102 })] }),
    fixture([document(1, 4), document(1, 5)], { "1": [good()] }),
    fixture([document(1, 5)], { "1": [good({ barcode: null })] }),
    fixture([document(1, 5)], {
      "1": [
        good({ quantity: Number.MAX_SAFE_INTEGER }),
        good({ barcode: "460000002" }),
      ],
    }),
  ])
    await assert.rejects(f.run(), MarketplaceProviderError);
});

test("WB paginates supply and goods collections without dropping boundary rows", async () => {
  const documents = Array.from({ length: 1000 }, (_, index) =>
    document(index + 1, 5),
  );
  const goods = Array.from({ length: 1000 }, (_, index) =>
    good({
      barcode: `460000${index}`,
      quantity: 1,
      acceptedQuantity: 1,
      readyForSaleQuantity: 0,
    }),
  );
  const f = fixture(documents, { "1": goods });
  const result = await f.run();
  assert.equal(result.supplies.length, 1000);
  assert.equal(result.inbound[0]!.units, 1000);
  assert.equal(
    f.calls.filter((call) => call.url.pathname === "/api/v1/supplies").length,
    3,
  );
  assert.ok(
    f.calls.some(
      (call) =>
        call.url.pathname.endsWith("/1/goods") &&
        call.url.searchParams.get("offset") === "1000",
    ),
  );
});

test("WB filters only completed documents by recent update, retains old active for review", async () => {
  const f = fixture(
    [
      document(1, 5, { updatedDate: "2026-08-01T00:00:00" }),
      document(2, 5),
      document(3, 6, {
        factDate: "2026-08-01T00:00:00",
        updatedDate: "2026-08-01T00:00:00",
      }),
    ],
    {
      "1": [good()],
      "2": [good()],
      "3": [good({ nmID: 102, barcode: "460000002" })],
    },
  );
  const result = await f.run();
  assert.deepEqual(
    result.supplies.map((item) => item.id),
    ["supply:3", "supply:2"],
  );
  assert.equal(
    result.inbound.find((item) => item.externalId === "101")!.units,
    50,
  );
  assert.equal(
    result.inbound.find((item) => item.externalId === "102")!.units,
    null,
  );
  const lists = f.calls.filter(
    (call) => call.url.pathname === "/api/v1/supplies",
  );
  assert.deepEqual(lists[0]!.body, { statusIDs: [2, 3, 4, 6] });
  assert.deepEqual(lists[1]!.body, {
    statusIDs: [5],
    dates: [{ from: "2026-09-26", till: "2026-10-27", type: "updatedDate" }],
  });
});

test("WB transport accepts strict numeric goods route and safe diagnostic only", async () => {
  let calls = 0;
  const request = client(
    { Authorization: "PRIVATE token" },
    {
      fetch: (async () => {
        calls++;
        return new Response("PRIVATE body", { status: 403 });
      }) as typeof fetch,
    },
  );
  for (const url of [
    "https://supplies-api.wildberries.ru/api/v1/supplies/PRIVATE/goods",
    "https://supplies-api.wildberries.ru/api/v1/supplies/1/goods/extra",
    "https://supplies-api.wildberries.ru/api/v1/supplies/0/goods",
    "https://supplies-api.wildberries.ru/api/v1/supplies/-1/goods",
    "https://supplies-api.wildberries.ru.evil/api/v1/supplies/1/goods",
  ])
    await assert.rejects(
      request(url),
      (error) =>
        error instanceof MarketplaceProviderError && error.code === "limit",
    );
  assert.equal(calls, 0);
  await assert.rejects(
    request(
      "https://supplies-api.wildberries.ru/api/v1/supplies/12345/goods?limit=1000&offset=0&isPreorderID=false",
    ),
    (error) => {
      assert.ok(error instanceof MarketplaceProviderError);
      assert.equal(error.code, "credentials");
      assert.equal(error.diagnostic?.operation, "/api/v1/supplies/{ID}/goods");
      assert.ok(!JSON.stringify(error).includes("PRIVATE"));
      assert.ok(!JSON.stringify(error).includes("12345"));
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("WB list/goods share 2.1-second pacing across retries", async (t) => {
  const times: number[] = [];
  t.mock.method(globalThis, "fetch", async () => {
    times.push(Date.now());
    return times.length === 2
      ? new Response("", { status: 429, headers: { "Retry-After": "0" } })
      : new Response("[]");
  });
  const request = client({}, {});
  await request(
    "https://supplies-api.wildberries.ru/api/v1/supplies?limit=1000&offset=0",
    { statusIDs: [2, 3, 4, 6] },
  );
  await request(
    "https://supplies-api.wildberries.ru/api/v1/supplies/1/goods?limit=1000&offset=0&isPreorderID=false",
  );
  assert.equal(times.length, 3);
  assert.ok(times[1]! - times[0]! >= 2050);
  assert.ok(times[2]! - times[1]! >= 2050);
});

test("WB cancellation interrupts shared supply pacing before another request", async (t) => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    controller.abort();
    return new Response("[]");
  });
  const request = client({}, { signal: controller.signal });
  // Earlier test's shared pacing is abortable, even before a first request.
  const pending = request(
    "https://supplies-api.wildberries.ru/api/v1/supplies?limit=1000&offset=0",
    {},
  );
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(
    pending,
    (error) =>
      error instanceof MarketplaceProviderError && error.code === "aborted",
  );
  assert.equal(calls, 0);
});
