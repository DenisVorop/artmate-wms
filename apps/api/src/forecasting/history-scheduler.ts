import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { ForecastHistoryService } from "./history.service";
/** Main-process only; importing DI/Swagger must never start requests. */
@Injectable()
export class ForecastHistoryScheduler implements OnModuleDestroy {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private active: Promise<void> | undefined;
  private started = false;
  private bootstrapped = false;
  private maintenanceDay: string | undefined;
  constructor(
    @Inject(ForecastHistoryService)
    private readonly service: ForecastHistoryService,
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
      if (!this.bootstrapped) {
        await this.service.bootstrap();
        this.bootstrapped = true;
      }
      const day = new Date(Date.now() + 10800000).toISOString().slice(0, 10);
      if (!controller.signal.aborted && this.maintenanceDay !== day) {
        await this.service.maintainAuthorizedHistory(controller.signal);
        this.maintenanceDay = day;
      }
      if (!controller.signal.aborted) {
        const result = await this.service.runNextHistoryPage(controller.signal);
        if (result === "complete") this.maintenanceDay = undefined;
      }
    } catch {
      console.warn("История маркетплейсов: загрузка продолжится позже");
    } finally {
      this.controller = undefined;
      this.active = undefined;
      if (this.started) {
        this.timer = setTimeout(() => {
          this.active = this._run();
        }, 1500);
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
