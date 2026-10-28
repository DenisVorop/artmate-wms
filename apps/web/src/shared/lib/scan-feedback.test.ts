import { test } from "node:test";
import assert from "node:assert/strict";
import { scanWithFeedback } from "./scan-feedback";
import { createScanQueue } from "./scan-queue";
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("confirmation sounds only after completion, including the final scan advancing its context", async () => {
  let finish!: (value: boolean) => void;
  const sounds: string[] = [];
  const result = scanWithFeedback(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    (accepted) => (accepted ? "success" : "error"),
    () => true,
    (kind) => sounds.push(kind),
  );
  assert.deepEqual(sounds, []);
  finish(true);
  assert.equal(await result, true);
  assert.deepEqual(sounds, ["success"]);
});
test("ordinary gateway pass remains synchronous and silent; handled/blocked have distinct results", () => {
  const sounds: string[] = [];
  for (const result of ["pass", "handled", "blocked"] as const) {
    assert.equal(
      scanWithFeedback(
        () => result,
        (r) => (r === "handled" ? "success" : r === "blocked" ? "error" : null),
        () => true,
        (kind) => sounds.push(kind),
      ),
      result,
    );
  }
  assert.deepEqual(sounds, ["success", "error"]);
});
test("rejected commands report one error and never success; old identities are silent", async () => {
  const sounds: string[] = [];
  await assert.rejects(
    async () =>
      scanWithFeedback(
        async () => {
          throw Error("offline");
        },
        () => "success",
        () => true,
        (kind) => sounds.push(kind),
      ),
    /offline/,
  );
  assert.throws(
    () =>
      scanWithFeedback(
        () => {
          throw Error("invalid");
        },
        () => "success",
        () => true,
        (kind) => sounds.push(kind),
      ),
    /invalid/,
  );
  await scanWithFeedback(
    async () => true,
    () => "success",
    () => false,
    (kind) => sounds.push(kind),
  );
  assert.deepEqual(sounds, ["error", "error"]);
});
test("buffered queue never sounds success on enqueue or for unsent scans after a failure", async () => {
  let finish!: (value: boolean) => void;
  const sounds: string[] = [],
    accepted: string[] = [];
  const queue = createScanQueue({
    repeat: true,
    isCurrent: () => true,
    changed: () => {},
    failed: () => {},
    dropped: () => {},
    accept: async (code) =>
      scanWithFeedback(
        () => {
          accepted.push(code);
          return new Promise<boolean>((resolve) => {
            finish = resolve;
          });
        },
        (ok) => (ok ? "success" : "error"),
        () => true,
        (kind) => sounds.push(kind),
      ),
  });
  queue.enqueue("wrong");
  queue.enqueue("next");
  assert.deepEqual(sounds, []);
  finish(false);
  await tick();
  assert.deepEqual(sounds, ["error"]);
  assert.deepEqual(accepted, ["wrong"]);
  queue.discardFailed();
  queue.close();
});
