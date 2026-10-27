import { Controller, Get, Inject, Res } from "@nestjs/common";
import { Response } from "express";
import { WarehouseService } from "./warehouse.service";
/** Public probes contain no warehouse data, account state, or error details. */
@Controller("health")
export class HealthController {
  constructor(
    @Inject(WarehouseService) private readonly warehouse: WarehouseService,
  ) {}
  @Get("live")
  live() {
    return { status: "ok" };
  }
  @Get("ready")
  async ready(@Res() response: Response) {
    try {
      await this.warehouse.checkReady();
      response.status(200).json({ status: "ok" });
    } catch {
      response.status(503).json({ status: "unavailable" });
    }
  }
}
