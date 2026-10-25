import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { MarketplaceService } from "./marketplace.service";
import { MARKETPLACE_PROVIDERS } from "./dto";
export const MARKETPLACE_SYNC_INTERVAL = 30 * 60_000;
type Timer = ReturnType<typeof setTimeout>;
type Runtime = {
  now: () => number;
  schedule: (callback: () => void, delay: number) => Timer;
  cancel: (timer: Timer) => void;
};
/** Started only by main.ts: generating Swagger or constructing a test app never imports live data. */
@Injectable()
export class MarketplaceScheduler implements OnModuleDestroy {
  private runtime: Runtime = {
    now: Date.now,
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: clearTimeout,
  };
  private stopped = true;
  private timer?: Timer;
  private cycle?: Promise<void>;
  private controller?: AbortController;
  constructor(
    @Inject(MarketplaceService)
    private readonly marketplaces: MarketplaceService,
  ) {}
  static forTesting(
    service: Pick<MarketplaceService, "syncMarketplaceAutomatically">,
    runtime: Runtime,
  ) {
    const scheduler = new MarketplaceScheduler(service as MarketplaceService);
    scheduler.runtime = runtime;
    return scheduler;
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this._scheduleNext();
    void this._run();
  }
  private _scheduleNext() {
    if (this.stopped) return;
    const delay =
      MARKETPLACE_SYNC_INTERVAL -
      (this.runtime.now() % MARKETPLACE_SYNC_INTERVAL);
    this.timer = this.runtime.schedule(() => {
      this.timer = undefined;
      this._scheduleNext();
      void this._run();
    }, delay);
    this.timer.unref?.();
  }
  private _run(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.cycle) return this.cycle;
    const slot =
      Math.floor(this.runtime.now() / MARKETPLACE_SYNC_INTERVAL) *
      MARKETPLACE_SYNC_INTERVAL;
    const controller = new AbortController();
    this.controller = controller;
    this.cycle = this._execute(slot, controller.signal).finally(() => {
      if (this.controller === controller) this.controller = undefined;
      this.cycle = undefined;
    });
    return this.cycle;
  }
  private async _execute(slot: number, signal: AbortSignal) {
    for (const provider of MARKETPLACE_PROVIDERS) {
      if (this.stopped || signal.aborted) return;
      try {
        const result = await this.marketplaces.syncMarketplaceAutomatically(
          provider,
          slot,
          signal,
        );
        if (result !== "skipped")
          console.info("Marketplace automatic sync", {
            provider,
            result,
            scheduledAt: new Date(slot).toISOString(),
          });
      } catch {
        // Exceptions may contain credentials or upstream payloads; never print them.
        if (!this.stopped)
          console.warn("Marketplace automatic sync could not finish", {
            provider,
          });
      }
    }
  }
  async stop() {
    this.stopped = true;
    if (this.timer !== undefined) this.runtime.cancel(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    await this.cycle;
  }
  onModuleDestroy() {
    return this.stop();
  }
}
