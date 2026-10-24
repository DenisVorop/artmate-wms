import { test } from "node:test";
import assert from "node:assert/strict";
import { createScanQueue, type ScanQueueState } from "./scan-queue";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup(accept: (v: string) => Promise<boolean>, repeat = true) {
  let current = true,
    state: ScanQueueState = { pending: 0, running: false, failedCode: null };
  const failed: string[] = [],
    dropped: number[] = [];
  const q = createScanQueue({
    accept,
    repeat,
    isCurrent: () => current,
    changed: (s) => (state = s),
    failed: (v) => failed.push(v),
    dropped: (n) => dropped.push(n),
  });
  return {
    q,
    failed,
    dropped,
    state: () => state,
    stale: () => (current = false),
  };
}
test("identical product codes are serialized without deduplication or parallel writes", async () => {
  let active = 0,
    max = 0;
  const received: string[] = [];
  const p = setup(async (v) => {
    active++;
    max = Math.max(active, max);
    await tick();
    received.push(v);
    active--;
    return true;
  });
  for (let i = 0; i < 20; i++) assert.equal(p.q.enqueue(" SKU "), true);
  for (let i = 0; i < 22; i++) await tick();
  assert.equal(received.length, 20);
  assert.ok(received.every((v) => v === "SKU"));
  assert.equal(max, 1);
  assert.equal(p.state().pending, 0);
});
test("failed scan pauses later codes and replacement retries the front without losing pending scans", async () => {
  const got: string[] = [];
  const p = setup(async (v) => {
    got.push(v);
    return v !== "wrong";
  });
  p.q.enqueue("wrong");
  p.q.enqueue("next");
  await tick();
  assert.deepEqual(got, ["wrong"]);
  assert.equal(p.state().failedCode, "wrong");
  p.q.enqueue("fixed");
  await tick();
  assert.deepEqual(got, ["wrong", "fixed", "next"]);
  assert.equal(p.state().pending, 0);
});
test("closing a box context stops unsent scans; an in-flight accepted command is not replayed", async () => {
  let finish!: (accepted: boolean) => void;
  const got: string[] = [];
  const p = setup((v) => {
    got.push(v);
    return new Promise((resolve) => (finish = resolve));
  });
  p.q.enqueue("first");
  p.q.enqueue("second");
  p.q.close();
  finish(true);
  await tick();
  assert.deepEqual(got, ["first"]);
  assert.deepEqual(p.dropped, [1]);
  assert.equal(p.q.enqueue("third"), false);
});
test("changed identity or operation prevents buffered writes before the old context unmounts", async () => {
  let finish!: (v: boolean) => void;
  const got: string[] = [];
  const p = setup((v) => {
    got.push(v);
    return new Promise((resolve) => (finish = resolve));
  });
  p.q.enqueue("first");
  p.q.enqueue("second");
  p.stale();
  finish(true);
  await tick();
  assert.deepEqual(got, ["first"]);
  assert.equal(p.q.enqueue("third"), false);
  p.q.close();
  assert.deepEqual(p.dropped, [1]);
});
test("a one-time scan refuses a second Enter while awaiting the operation", async () => {
  let finish!: (v: boolean) => void;
  const p = setup(() => new Promise((resolve) => (finish = resolve)), false);
  assert.equal(p.q.enqueue("pal"), true);
  assert.equal(p.q.enqueue("pal"), false);
  finish(true);
  await tick();
  assert.equal(p.state().pending, 0);
});
test("thrown network failure preserves the unaccepted scan and bounds the input queue", async () => {
  const p = setup(async () => {
    throw Error("offline");
  });
  for (let i = 0; i < 50; i++) assert.equal(p.q.enqueue(String(i)), true);
  assert.equal(p.q.enqueue("overflow"), false);
  await tick();
  assert.equal(p.state().failedCode, "0");
  assert.equal(p.state().pending, 50);
  assert.deepEqual(p.failed, ["0"]);
});
test("explicit failed recovery discards the failed front and its unsent backlog, then accepts new scans", async () => {
  const got: string[] = [];
  const p = setup(async (code) => {
    got.push(code);
    return code !== "wrong";
  });
  p.q.enqueue("wrong");
  p.q.enqueue("second");
  p.q.enqueue("third");
  await tick();
  assert.equal(p.q.discardFailed(), 3);
  assert.deepEqual(p.state(), { pending: 0, running: false, failedCode: null });
  assert.deepEqual(got, ["wrong"]);
  assert.deepEqual(p.dropped, []);
  assert.equal(p.q.discardFailed(), 0);
  assert.equal(p.q.enqueue("new"), true);
  await tick();
  assert.deepEqual(got, ["wrong", "new"]);
  assert.equal(p.state().pending, 0);
});
test("recovery never removes an in-flight scan or its queued followers", async () => {
  let finish!: (accepted: boolean) => void;
  const got: string[] = [];
  const p = setup(async (code) => {
    got.push(code);
    if (code === "first")
      return new Promise<boolean>((resolve) => (finish = resolve));
    return true;
  });
  p.q.enqueue("first");
  p.q.enqueue("second");
  assert.equal(p.q.discardFailed(), 0);
  assert.equal(p.state().pending, 2);
  finish(true);
  await tick();
  assert.deepEqual(got, ["first", "second"]);
  assert.equal(p.state().pending, 0);
});
test("explicit recovery publishes idle activity even after the failed context becomes disabled", async () => {
  const p = setup(async () => false);
  p.q.enqueue("wrong");
  await tick();
  p.stale();
  assert.equal(p.q.discardFailed(), 1);
  assert.deepEqual(p.state(), { pending: 0, running: false, failedCode: null });
  assert.equal(p.q.enqueue("other context"), false);
});
test("external disabling during a request settles it and preserves only the unaccepted codes for recovery", async () => {
  for (const accepted of [true, false]) {
    let finish!: (accepted: boolean) => void;
    const got: string[] = [];
    const p = setup((code) => {
      got.push(code);
      return new Promise<boolean>((resolve) => (finish = resolve));
    });
    p.q.enqueue("first");
    p.q.enqueue("second");
    p.stale();
    finish(accepted);
    await tick();
    assert.deepEqual(got, ["first"]);
    assert.equal(p.state().running, false);
    assert.equal(p.state().failedCode, accepted ? "second" : "first");
    assert.equal(p.q.discardFailed(), accepted ? 1 : 2);
    assert.equal(p.state().pending, 0);
  }
});
