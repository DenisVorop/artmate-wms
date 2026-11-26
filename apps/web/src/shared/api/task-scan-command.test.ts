import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiFetch } from "./transport";
function memoryStorage() {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    key: (i) => [...values.keys()][i] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  return { storage, values };
}
const scan = (requestId: string) => ({
  requestId,
  kind: "assembly",
  id: "task",
  value: "4601234000028",
  step: "Сканируйте каждую раскраску",
});
test("a confirmed scan log permits all 20 identical item scans to reach assembly", async () => {
  const { storage, values } = memoryStorage();
  const ids: string[] = [];
  const request = createApiFetch({
    storage: () => storage,
    fetch: async (_url, options) => {
      ids.push(JSON.parse(options!.body as string).requestId);
      return Response.json({ recorded: true });
    },
  });
  let scannedUnits = 0;
  for (let i = 1; i <= 20; i++) {
    await request("/api/task-scans", {
      method: "POST",
      body: JSON.stringify(scan(`scan-${i}`)),
    });
    // The EmployeeScan callback is awaited after its logging request.
    scannedUnits++;
    assert.equal(scannedUnits, i);
    assert.equal(values.size, 0);
  }
  assert.equal(new Set(ids).size, 20);
});
test("a malformed scan acknowledgement stays unresolved and retries its original ID", async () => {
  const { storage, values } = memoryStorage();
  const ids: string[] = [];
  let reply: unknown = { recorded: false };
  const request = createApiFetch({
    storage: () => storage,
    fetch: async (_url, options) => {
      ids.push(JSON.parse(options!.body as string).requestId);
      return Response.json(reply);
    },
  });
  for (const invalid of [
    null,
    {},
    [],
    { recorded: false },
    { recorded: "true" },
  ]) {
    reply = invalid;
    await assert.rejects(
      request("/api/task-scans", {
        method: "POST",
        body: JSON.stringify(scan("first")),
      }),
      /неподтверждённый/,
    );
    assert.equal(values.size, 1);
  }
  reply = { recorded: true };
  assert.deepEqual(
    await request("/api/task-scans", {
      method: "POST",
      body: JSON.stringify(scan("retry")),
    }),
    { recorded: true },
  );
  assert(ids.every((id) => id === "first"));
  assert.equal(values.size, 0);
  await assert.rejects(
    request("/api/tasks/task/scan", {
      method: "POST",
      body: JSON.stringify(scan("warehouse")),
    }),
    /неподтверждённый/,
  );
});
