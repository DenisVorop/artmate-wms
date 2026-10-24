import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiFetch } from "./transport";
import { isBoxLabelBatchResponse } from "./box-label-response";
const batch = {
  id: "batch",
  code: "LBL-1",
  count: 100,
  freeCount: 100,
  assignedCount: 0,
  createdAt: "2026-10-25T10:00:00Z",
};
test("Batch response guard rejects incomplete or inconsistent issued pool", () => {
  assert.equal(isBoxLabelBatchResponse(batch), true);
  for (const value of [
    null,
    {},
    [],
    { ...batch, count: 0 },
    { ...batch, count: 1001 },
    { ...batch, freeCount: 99 },
    { ...batch, assignedCount: -1 },
    { ...batch, createdAt: "unknown" },
    { ...batch, id: "" },
  ])
    assert.equal(isBoxLabelBatchResponse(value), false);
});
test("Uncertain batch issuance reuses requestId and confirms batch without accepting it for stock commands", async () => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const seen: string[] = [];
  let tries = 0;
  const request = createApiFetch({
    storage: () => storage,
    fetch: async (_url, options) => {
      seen.push(JSON.parse(options!.body as string).requestId);
      return new Response(JSON.stringify(tries++ ? batch : { id: "batch" }), {
        status: 200,
      });
    },
  });
  await assert.rejects(
    request("/api/box-label-batches", {
      method: "POST",
      body: JSON.stringify({ requestId: "first", count: 100 }),
    }),
    /неподтверждённый/,
  );
  assert.equal(values.size, 1);
  assert.deepEqual(
    await request("/api/box-label-batches", {
      method: "POST",
      body: JSON.stringify({ requestId: "second", count: 100 }),
    }),
    batch,
  );
  assert.deepEqual(seen, ["first", "first"]);
  assert.equal(values.size, 0);
  await assert.rejects(
    request("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ requestId: "third", count: 100 }),
    }),
    /неподтверждённый/,
  );
  assert.equal(values.size, 1);
});
