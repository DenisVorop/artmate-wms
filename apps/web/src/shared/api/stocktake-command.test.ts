import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiFetch } from "./transport";
import { isStocktakeCommandResponse } from "./stocktake-response";
const document = {
  id: "stocktake-1",
  code: "INV-1",
  revision: 1,
  status: "queued",
  rows: [{ locationId: "A-1" }],
};
function storagePort() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  } as const;
}
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
test("Document confirmation does not accept malformed, empty or unknown-status results", () => {
  for (const invalid of [
    null,
    {},
    [],
    { ...document, revision: -1 },
    { ...document, status: "unknown" },
    { ...document, rows: [] },
    { ...document, rows: [{ locationId: null }] },
  ])
    assert.equal(isStocktakeCommandResponse(invalid), false);
  assert.equal(isStocktakeCommandResponse(document), true);
});
test("Stocktake POST accepts its document and clears replay key; other warehouse commands keep snapshot validation", async () => {
  for (const path of [
    "/api/stocktakes",
    "/api/stocktakes/stocktake-1/claim",
    "/api/stocktakes/stocktake-1/rows/A-1/count",
  ]) {
    const port = storagePort();
    const request = createApiFetch({
      storage: () => port.storage,
      fetch: async () => json(document),
    });
    const result = await request(path, {
      method: "POST",
      body: JSON.stringify({ requestId: "request-1" }),
    });
    assert.deepEqual(result, document);
    assert.equal(port.values.size, 0);
  }
  const port = storagePort();
  const request = createApiFetch({
    storage: () => port.storage,
    fetch: async () => json(document),
  });
  await assert.rejects(
    request("/api/locations", {
      method: "POST",
      body: JSON.stringify({ requestId: "request-1" }),
    }),
    /неподтверждённый результат/,
  );
  assert.equal(port.values.size, 1);
});
test("Ambiguous successful document response keeps the original request ID until explicit retry confirms it", async () => {
  const port = storagePort();
  let attempt = 0;
  const seen: string[] = [];
  const request = createApiFetch({
    storage: () => port.storage,
    fetch: async (_url, options) => {
      seen.push(JSON.parse(options!.body as string).requestId);
      return json(attempt++ === 0 ? { id: "stocktake-1" } : document);
    },
  });
  await assert.rejects(
    request("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({ requestId: "first", locationIds: ["A-1"] }),
    }),
    /неподтверждённый результат/,
  );
  assert.equal(port.values.size, 1);
  assert.deepEqual(
    await request("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({ requestId: "new", locationIds: ["A-1"] }),
    }),
    document,
  );
  assert.deepEqual(seen, ["first", "first"]);
  assert.equal(port.values.size, 0);
});
