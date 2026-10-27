import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { WorkAutomationService } from "./service";
export const WORK_AUTOMATION_INTERVAL_MS = 15_000;
/** Inert during DI and OpenAPI export. Production main owns its lifecycle. */
@Injectable()
export class WorkAutomationScheduler implements OnModuleDestroy {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<void> | undefined;
  private controller: AbortController | undefined;
  private started = false;
  constructor(
    @Inject(WorkAutomationService)
    private readonly service: WorkAutomationService,
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
      await this.service.runWorkAutomation(controller.signal);
    } catch {
      if (!controller.signal.aborted)
        console.warn("Автопланирование: повторим проверку автоматически");
    } finally {
      this.controller = undefined;
      this.active = undefined;
      if (this.started) {
        this.timer = setTimeout(() => {
          this.active = this._run();
        }, WORK_AUTOMATION_INTERVAL_MS);
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
