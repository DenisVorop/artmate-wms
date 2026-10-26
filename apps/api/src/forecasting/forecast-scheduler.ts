import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { ForecastService } from "./forecast-service";
export const FORECAST_RECHECK_MS = 60_000;
/** Inert in DI, tests and Swagger. Main explicitly owns start/stop. */
@Injectable()
export class ForecastScheduler implements OnModuleDestroy {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private active: Promise<void> | undefined;
  private started = false;
  constructor(
    @Inject(ForecastService) private readonly service: ForecastService,
  ) {}
  start() {
    if (this.started) return;
    this.started = true;
    this.active = this._run();
  }
  private async _run() {
    const controller = new AbortController();
    this.controller = controller;
    try {
      await this.service.runForecastComputation(controller.signal);
    } catch {
      console.warn("Прогноз: расчёт продолжится автоматически");
    } finally {
      this.controller = undefined;
      this.active = undefined;
      if (this.started) {
        this.timer = setTimeout(() => {
          this.active = this._run();
        }, FORECAST_RECHECK_MS);
        this.timer.unref();
      }
    }
  }
  async stop() {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    await this.active;
  }
  async onModuleDestroy() {
    await this.stop();
  }
}
