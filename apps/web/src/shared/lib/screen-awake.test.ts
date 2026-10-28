import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createScreenAwake,
  type ScreenAwakeState,
  type ScreenLock,
} from "./screen-awake";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function token() {
  let listener = () => {};
  const value = {
    released: false,
    releases: 0,
    release: async () => {
      value.released = true;
      value.releases++;
      listener();
    },
    addEventListener: (_type: "release", callback: () => void) => {
      listener = callback;
    },
  };
  return value;
}
test("one lock while working, release in background, reacquire on return and end on break", async () => {
  let visible = true;
  const locks: ReturnType<typeof token>[] = [],
    states: ScreenAwakeState[] = [];
  const awake = createScreenAwake({
    visible: () => visible,
    request: async () => {
      const lock = token();
      locks.push(lock);
      return lock;
    },
    changed: (state) => states.push(state),
  });
  awake.setActive(true);
  awake.refresh();
  awake.refresh();
  await tick();
  assert.equal(locks.length, 1);
  assert.equal(states.at(-1), "on");
  visible = false;
  awake.refresh();
  await tick();
  assert.equal(locks[0].releases, 1);
  assert.equal(states.at(-1), "off");
  visible = true;
  awake.refresh();
  await tick();
  assert.equal(locks.length, 2);
  assert.equal(states.at(-1), "on");
  awake.setActive(false);
  await tick();
  assert.equal(locks[1].releases, 1);
  assert.equal(states.at(-1), "off");
  awake.refresh();
  assert.equal(locks.length, 2);
  awake.close();
});
test("a late acquired lock is released after unmount/session end", async () => {
  let finish!: (lock: ScreenLock) => void;
  const states: ScreenAwakeState[] = [],
    lock = token();
  const awake = createScreenAwake({
    visible: () => true,
    request: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    changed: (state) => states.push(state),
  });
  awake.setActive(true);
  awake.close();
  const count = states.length;
  finish(lock);
  await tick();
  assert.equal(lock.releases, 1);
  assert.equal(states.length, count);
});
test("a stale request cannot replace a new visible session lock", async () => {
  const pending: ((lock: ScreenLock) => void)[] = [],
    states: ScreenAwakeState[] = [];
  const awake = createScreenAwake({
    visible: () => true,
    request: () => new Promise((resolve) => pending.push(resolve)),
    changed: (state) => states.push(state),
  });
  awake.setActive(true);
  awake.setActive(false);
  awake.setActive(true);
  const stale = token(),
    current = token();
  pending[1](current);
  await tick();
  pending[0](stale);
  await tick();
  assert.equal(stale.releases, 1);
  assert.equal(current.releases, 0);
  assert.equal(states.at(-1), "on");
  awake.close();
  assert.equal(current.releases, 1);
});
test("missing API or denied request reports unavailable without a retry loop", async () => {
  for (const denied of [false, true]) {
    let calls = 0;
    const states: ScreenAwakeState[] = [];
    const awake = createScreenAwake({
      visible: () => true,
      request: denied
        ? async () => {
            calls++;
            throw Error("power saving");
          }
        : undefined,
      changed: (state) => states.push(state),
    });
    awake.setActive(true);
    await tick();
    await tick();
    assert.equal(states.at(-1), "unavailable");
    assert.equal(calls, denied ? 1 : 0);
    awake.close();
  }
});
test("system release is visible and retried only on a later explicit refresh", async () => {
  const locks: ReturnType<typeof token>[] = [],
    states: ScreenAwakeState[] = [];
  const awake = createScreenAwake({
    visible: () => true,
    request: async () => {
      const lock = token();
      locks.push(lock);
      return lock;
    },
    changed: (state) => states.push(state),
  });
  awake.setActive(true);
  await tick();
  await locks[0].release();
  await tick();
  assert.equal(states.at(-1), "unavailable");
  assert.equal(locks.length, 1);
  awake.refresh();
  await tick();
  assert.equal(locks.length, 2);
  awake.close();
});
