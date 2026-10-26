import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ForecastScheduler,
  FORECAST_RECHECK_MS,
} from "../src/forecasting/forecast-scheduler";
import type { ForecastService } from "../src/forecasting/forecast-service";
test("forecast scheduler stays inert until main start, deduplicates start and aborts before stop completes", async () => {
  let calls = 0,
    aborted = false;
  const scheduler = new ForecastScheduler({
    runForecastComputation: async (signal: AbortSignal) => {
      calls++;
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve();
          },
          { once: true },
        ),
      );
    },
  } as unknown as ForecastService);
  assert.equal(calls, 0);
  assert.equal(FORECAST_RECHECK_MS, 60000);
  scheduler.start();
  scheduler.start();
  assert.equal(calls, 1);
  await scheduler.stop();
  assert.equal(aborted, true);
  assert.equal(calls, 1);
  await scheduler.stop();
  assert.equal(calls, 1);
});
