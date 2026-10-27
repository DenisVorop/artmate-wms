import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WorkAutomationScheduler,
  WORK_AUTOMATION_INTERVAL_MS,
} from "../src/work-automation/scheduler";
import type { WorkAutomationService } from "../src/work-automation/service";
test("automatic work scheduler is inert, starts once, serializes runs and aborts shutdown", async () => {
  assert.equal(WORK_AUTOMATION_INTERVAL_MS, 15000);
  let calls = 0;
  let aborted = false;
  const scheduler = new WorkAutomationScheduler({
    runWorkAutomation: async (signal: AbortSignal) => {
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
      return "skipped";
    },
  } as unknown as WorkAutomationService);
  assert.equal(calls, 0);
  scheduler.start();
  scheduler.start();
  assert.equal(calls, 1);
  await scheduler.stop();
  assert.equal(aborted, true);
  await scheduler.onModuleDestroy();
  assert.equal(calls, 1);
});
