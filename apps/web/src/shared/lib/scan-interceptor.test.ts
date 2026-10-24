import assert from "node:assert/strict";
import test from "node:test";
import { createScanInterceptor } from "./scan-interceptor";
import { createScanQueue } from "./scan-queue";
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("six rapid identical business scans bypass asynchronous interception and all reach the serial queue", async () => {
  const accepted: string[] = [];
  let intercepted = 0;
  const route = createScanInterceptor({
    canIntercept: (value) => value.startsWith("ZONE:"),
    intercept: async () => {
      intercepted++;
      return "handled" as const;
    },
    changed: () => {},
  });
  const queue = createScanQueue({
    repeat: true,
    isCurrent: () => true,
    accept: async (value) => {
      accepted.push(value);
      await tick();
      return true;
    },
    changed: () => {},
    failed: () => {},
    dropped: () => {},
  });
  for (let i = 0; i < 6; i++) {
    const result = route("SKU");
    assert.equal(result, "pass");
    if (result === "pass") assert.equal(queue.enqueue("SKU"), true);
  }
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(intercepted, 0);
  assert.deepEqual(accepted, ["SKU", "SKU", "SKU", "SKU", "SKU", "SKU"]);
});
test("an in-flight intercepted operation blocks other zone and ordinary codes until completion", async () => {
  let finish!: (value: "handled") => void;
  const states: boolean[] = [];
  let calls = 0;
  const route = createScanInterceptor({
    canIntercept: (value) => value.startsWith("ZONE:"),
    intercept: () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    changed: (value) => states.push(value),
  });
  const first = route("ZONE:first");
  assert.equal(route("SKU"), "blocked");
  assert.equal(route("ZONE:second"), "blocked");
  assert.equal(calls, 1);
  finish("handled");
  assert.equal(await first, "handled");
  assert.equal(route("SKU"), "pass");
  assert.deepEqual(states, [true, false]);
});
test("failed zone handling releases the gate and never consumes a failed business scan", async () => {
  let pending = false;
  const codes: string[] = [];
  const queue = createScanQueue({
    repeat: true,
    isCurrent: () => true,
    accept: async (value) => {
      codes.push(value);
      return value !== "wrong";
    },
    changed: () => {},
    failed: () => {},
    dropped: () => {},
  });
  queue.enqueue("wrong");
  queue.enqueue("later");
  await tick();
  const route = createScanInterceptor({
    canIntercept: () => true,
    intercept: async () => {
      throw new Error("offline");
    },
    changed: (value) => {
      pending = value;
    },
  });
  await assert.rejects(Promise.resolve(route("ZONE:first")), /offline/);
  assert.equal(pending, false);
  queue.enqueue("fixed");
  await tick();
  assert.deepEqual(codes, ["wrong", "fixed", "later"]);
});
