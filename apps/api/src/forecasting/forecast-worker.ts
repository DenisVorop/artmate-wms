import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  computeForecast,
  type ForecastComputeInput,
} from "./forecast-projection";
import type { ForecastCache } from "./forecast-storage";

if (!isMainThread && parentPort) {
  parentPort.once("message", (input: ForecastComputeInput) => {
    try {
      parentPort!.postMessage({ ok: true, value: computeForecast(input) });
    } catch {
      parentPort!.postMessage({ ok: false });
    }
  });
}
/** CPU work stays outside the API event loop and SQL transaction. */
export function computeForecastInWorker(
  input: ForecastComputeInput,
  signal?: AbortSignal,
): Promise<ForecastCache> {
  if (signal?.aborted)
    return Promise.reject(new Error("Forecast computation stopped"));
  const compiled = join(__dirname, "forecast-worker.js");
  const worker = existsSync(compiled)
    ? new Worker(compiled)
    : new Worker(
        `require(${JSON.stringify(require.resolve("tsx/cjs"))});require(${JSON.stringify(join(__dirname, "forecast-worker.ts"))});`,
        { eval: true },
      );
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value?: ForecastCache) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      void worker.terminate();
      if (value) resolve(value);
      else reject(new Error("Forecast computation unavailable"));
    };
    const aborted = () => finish();
    const timer = setTimeout(() => finish(), 60_000);
    timer.unref();
    signal?.addEventListener("abort", aborted, { once: true });
    worker.once("message", (message: { ok: boolean; value?: ForecastCache }) =>
      finish(message.ok ? message.value : undefined),
    );
    worker.once("error", () => finish());
    worker.once("exit", () => finish());
    if (signal?.aborted) {
      finish();
      return;
    }
    worker.postMessage(input);
  });
}
