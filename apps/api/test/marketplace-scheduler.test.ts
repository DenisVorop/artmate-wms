import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import {
  MarketplaceScheduler,
  MARKETPLACE_SYNC_INTERVAL,
} from "../src/marketplaces/marketplace-scheduler";
function clock(initial: number) {
  let now = initial;
  const timers = new Map<
    ReturnType<typeof setTimeout>,
    { at: number; callback: () => void }
  >();
  const runtime = {
    now: () => now,
    schedule: (callback: () => void, delay: number) => {
      const timer = { unref: () => {} } as ReturnType<typeof setTimeout>;
      timers.set(timer, { at: now + delay, callback });
      return timer;
    },
    cancel: (timer: ReturnType<typeof setTimeout>) => {
      timers.delete(timer);
    },
  };
  return {
    runtime,
    timers,
    advance: (target: number) => {
      now = target;
      const due = [...timers].filter(([, entry]) => entry.at <= target);
      for (const [timer, entry] of due) {
        timers.delete(timer);
        entry.callback();
      }
    },
  };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
test("scheduler is inert until start, runs once on startup, aligns :00/:30 and catches up sleep without a backlog", async () => {
  const initial = Date.UTC(2026, 9, 26, 8, 17),
    c = clock(initial);
  const calls: { provider: string; slot: number }[] = [];
  const s = MarketplaceScheduler.forTesting(
    {
      syncMarketplaceAutomatically: async (provider, slot) => {
        calls.push({ provider, slot });
        return "skipped";
      },
    },
    c.runtime,
  );
  assert.equal(calls.length, 0);
  s.start();
  s.start();
  await flush();
  assert.deepEqual(
    calls.map((x) => x.provider),
    ["wildberries", "ozon"],
  );
  assert.ok(calls.every((x) => x.slot === Date.UTC(2026, 9, 26, 8, 0)));
  assert.equal(c.timers.size, 1);
  assert.equal([...c.timers.values()][0].at, Date.UTC(2026, 9, 26, 8, 30));
  c.advance(Date.UTC(2026, 9, 26, 8, 29));
  await flush();
  assert.equal(calls.length, 2);
  c.advance(Date.UTC(2026, 9, 26, 8, 30));
  await flush();
  assert.equal(calls.length, 4);
  assert.equal(calls[2].slot, Date.UTC(2026, 9, 26, 8, 30));
  c.advance(Date.UTC(2026, 9, 26, 12, 12));
  await flush();
  assert.equal(calls.length, 6);
  assert.equal(calls[4].slot, Date.UTC(2026, 9, 26, 12, 0));
  assert.equal([...c.timers.values()][0].at, Date.UTC(2026, 9, 26, 12, 30));
  await s.stop();
  assert.equal(c.timers.size, 0);
  c.advance(Date.UTC(2026, 9, 26, 13, 0));
  await flush();
  assert.equal(calls.length, 6);
});
test("no overlapping cycles; stopping aborts pending work before another provider", async () => {
  const c = clock(Date.UTC(2026, 9, 26, 8, 0));
  let calls = 0;
  let active: AbortSignal | undefined;
  const s = MarketplaceScheduler.forTesting(
    {
      syncMarketplaceAutomatically: async (_provider, _slot, signal) => {
        calls++;
        active = signal;
        return new Promise<"skipped">((resolve) =>
          signal!.addEventListener("abort", () => resolve("skipped"), {
            once: true,
          }),
        );
      },
    },
    c.runtime,
  );
  s.start();
  assert.equal(calls, 1);
  c.advance(c.runtime.now() + MARKETPLACE_SYNC_INTERVAL);
  await flush();
  assert.equal(calls, 1);
  await s.stop();
  assert.equal(active!.aborted, true);
  assert.equal(calls, 1);
  assert.equal(c.timers.size, 0);
});
test("one provider failure does not suppress the other or leak exception text", async () => {
  const c = clock(Date.UTC(2026, 9, 26, 8, 0));
  const providers: string[] = [];
  const old = console.warn;
  const logs: unknown[][] = [];
  console.warn = (...args) => {
    logs.push(args);
  };
  try {
    const s = MarketplaceScheduler.forTesting(
      {
        syncMarketplaceAutomatically: async (provider) => {
          providers.push(provider);
          if (provider === "wildberries")
            throw Error("private-key upstream body");
          return "skipped";
        },
      },
      c.runtime,
    );
    s.start();
    await flush();
    await s.stop();
    assert.deepEqual(providers, ["wildberries", "ozon"]);
    assert.ok(!JSON.stringify(logs).includes("private-key"));
  } finally {
    console.warn = old;
  }
});

test("a boundary crossed during a slow import catches up only the latest slot after the old cycle completes", async () => {
  const initial = Date.UTC(2026, 9, 26, 8, 25),
    c = clock(initial),
    oldSlot = Date.UTC(2026, 9, 26, 8, 0);
  const calls: { provider: string; slot: number }[] = [];
  let finishOld!: () => void,
    active = 0,
    maxActive = 0;
  const s = MarketplaceScheduler.forTesting(
    {
      syncMarketplaceAutomatically: async (provider, slot) => {
        calls.push({ provider, slot });
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          if (provider === "ozon" && slot === oldSlot)
            await new Promise<void>((resolve) => {
              finishOld = resolve;
            });
          return "skipped";
        } finally {
          active--;
        }
      },
    },
    c.runtime,
  );
  s.start();
  await flush();
  assert.equal(calls.length, 2);
  c.advance(Date.UTC(2026, 9, 26, 8, 30));
  await flush();
  assert.equal(calls.length, 2);
  c.advance(Date.UTC(2026, 9, 26, 10, 12));
  await flush();
  assert.equal(calls.length, 2);
  finishOld();
  await flush();
  assert.deepEqual(calls, [
    { provider: "wildberries", slot: oldSlot },
    { provider: "ozon", slot: oldSlot },
    { provider: "wildberries", slot: Date.UTC(2026, 9, 26, 10, 0) },
    { provider: "ozon", slot: Date.UTC(2026, 9, 26, 10, 0) },
  ]);
  assert.equal(maxActive, 1);
  await flush();
  assert.equal(calls.length, 4);
  assert.equal([...c.timers.values()][0].at, Date.UTC(2026, 9, 26, 10, 30));
  await s.stop();
});

test("stop awaits cleanup of a catch-up cycle and prevents its remaining provider or another queued slot", async () => {
  const oldSlot = Date.UTC(2026, 9, 26, 8, 0),
    c = clock(Date.UTC(2026, 9, 26, 8, 25));
  const calls: { provider: string; slot: number }[] = [];
  let finishOld!: () => void,
    finishCleanup!: () => void,
    catchupSignal: AbortSignal | undefined;
  const s = MarketplaceScheduler.forTesting(
    {
      syncMarketplaceAutomatically: async (provider, slot, signal) => {
        calls.push({ provider, slot });
        if (provider === "ozon" && slot === oldSlot)
          await new Promise<void>((resolve) => {
            finishOld = resolve;
          });
        if (slot > oldSlot) {
          catchupSignal = signal;
          await new Promise<void>((resolve) => {
            finishCleanup = resolve;
          });
        }
        return "skipped";
      },
    },
    c.runtime,
  );
  s.start();
  await flush();
  c.advance(Date.UTC(2026, 9, 26, 8, 30));
  finishOld();
  await flush();
  assert.equal(calls.length, 3);
  assert.equal(catchupSignal?.aborted, false);
  c.advance(Date.UTC(2026, 9, 26, 9, 0));
  await flush();
  assert.equal(calls.length, 3);
  let stopped = false;
  const stopping = s.stop().then(() => {
    stopped = true;
  });
  await flush();
  assert.equal(catchupSignal?.aborted, true);
  assert.equal(stopped, false);
  finishCleanup();
  await stopping;
  assert.equal(stopped, true);
  assert.equal(calls.length, 3);
  assert.equal(c.timers.size, 0);
  c.advance(Date.UTC(2026, 9, 26, 9, 30));
  await flush();
  assert.equal(calls.length, 3);
});
