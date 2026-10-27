import { test } from "node:test";
import assert from "node:assert/strict";
import { createShutdown } from "../src/runtime-lifecycle";
test("shutdown aborts every producer, awaits its SQL cleanup and closes once", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const close = createShutdown(
    [
      {
        stop: async () => {
          calls.push("stop1");
          await wait;
          calls.push("cleanup1");
        },
      },
      {
        stop: async () => {
          calls.push("stop2");
          calls.push("cleanup2");
        },
      },
    ],
    async () => {
      calls.push("close");
    },
  );
  const a = close(),
    b = close();
  assert.equal(a, b);
  assert.deepEqual(calls, ["stop1", "stop2", "cleanup2"]);
  release();
  await a;
  assert.deepEqual(calls, ["stop1", "stop2", "cleanup2", "cleanup1", "close"]);
  await close();
  assert.equal(calls.filter((c) => c === "close").length, 1);
});
test("failed producer does not prevent other cleanup or database close", async () => {
  const calls: string[] = [];
  const close = createShutdown(
    [
      {
        stop: async () => {
          throw new Error("private upstream details");
        },
      },
      {
        stop: async () => {
          calls.push("other cleanup");
        },
      },
    ],
    async () => {
      calls.push("close");
    },
  );
  await assert.rejects(
    close(),
    /^Error: Background work could not shut down cleanly$/,
  );
  assert.deepEqual(calls, ["other cleanup", "close"]);
});
