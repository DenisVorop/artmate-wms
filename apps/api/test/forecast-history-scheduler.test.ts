import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ForecastHistoryScheduler } from "../src/forecasting/history-scheduler";
import type { ForecastHistoryService } from "../src/forecasting/history.service";
test("history scheduler remains inert until main starts it, starts once and aborts its pending page before shutdown", async () => {
  let bootstrap = 0,
    pages = 0,
    signal: AbortSignal | undefined;
  let done!: () => void;
  const entered = new Promise<void>((r) => {
    done = r;
  });
  const service = {
    maintainAuthorizedHistory: async () => 0,
    bootstrap: async () => {
      bootstrap++;
    },
    runNextHistoryPage: async (s: AbortSignal) => {
      pages++;
      signal = s;
      done();
      await new Promise<void>((r) =>
        s.addEventListener("abort", () => r(), { once: true }),
      );
      return "queued";
    },
  } as unknown as ForecastHistoryService;
  const scheduler = new ForecastHistoryScheduler(service);
  assert.equal(bootstrap, 0);
  scheduler.start();
  scheduler.start();
  await entered;
  assert.equal(bootstrap, 1);
  assert.equal(pages, 1);
  await scheduler.stop();
  assert.equal(signal?.aborted, true);
  await scheduler.onModuleDestroy();
  assert.equal(pages, 1);
});
