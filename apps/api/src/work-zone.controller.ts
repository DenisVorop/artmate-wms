import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import * as D from "./dto";
import { WarehouseService } from "./warehouse.service";
const pipe = (type: new () => unknown) =>
  new ValidationPipe({
    expectedType: type,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
@ApiCookieAuth()
@ApiTags("work-zones")
@Controller("api/work-zones")
export class WorkZoneController {
  constructor(
    @Inject(WarehouseService) private readonly warehouse: WarehouseService,
  ) {}
  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: "createWorkZone" })
  @ApiBody({ type: D.CreateWorkZoneDto })
  @ApiOkResponse({ type: D.WorkspaceDto })
  createWorkZone(@Body(pipe(D.CreateWorkZoneDto)) b: D.CreateWorkZoneDto) {
    return this.warehouse.createWorkZone(b);
  }
  @Post("start")
  @HttpCode(200)
  @ApiOperation({ operationId: "startZoneWork" })
  @ApiBody({ type: D.StartZoneWorkDto })
  @ApiOkResponse({ type: D.WorkspaceDto })
  startZoneWork(@Body(pipe(D.StartZoneWorkDto)) b: D.StartZoneWorkDto) {
    return this.warehouse.startZoneWork(b);
  }
  @Post("leave")
  @HttpCode(200)
  @ApiOperation({ operationId: "leaveZoneWork" })
  @ApiBody({ type: D.ClaimTaskDto })
  @ApiOkResponse({ type: D.WorkspaceDto })
  leaveZoneWork(@Body(pipe(D.ClaimTaskDto)) b: D.ClaimTaskDto) {
    return this.warehouse.leaveZoneWork(b);
  }
  @Post(":id")
  @HttpCode(200)
  @ApiOperation({ operationId: "updateWorkZone" })
  @ApiParam({ name: "id", type: String })
  @ApiBody({ type: D.UpdateWorkZoneDto })
  @ApiOkResponse({ type: D.WorkspaceDto })
  updateWorkZone(
    @Param("id") id: string,
    @Body(pipe(D.UpdateWorkZoneDto)) b: D.UpdateWorkZoneDto,
  ) {
    return this.warehouse.updateWorkZone(id, b);
  }
  @Post(":id/archive")
  @HttpCode(200)
  @ApiOperation({ operationId: "archiveWorkZone" })
  @ApiParam({ name: "id", type: String })
  @ApiBody({ type: D.CommandDto })
  @ApiOkResponse({ type: D.WorkspaceDto })
  archiveWorkZone(
    @Param("id") id: string,
    @Body(pipe(D.CommandDto)) b: D.CommandDto,
  ) {
    return this.warehouse.archiveWorkZone(id, b);
  }
  @Post(":id/restore")
  @HttpCode(200)
  @ApiOperation({ operationId: "restoreWorkZone" })
  @ApiParam({ name: "id", type: String })
  @ApiBody({ type: D.CommandDto })
  @ApiOkResponse({ type: D.WorkspaceDto })
  restoreWorkZone(
    @Param("id") id: string,
    @Body(pipe(D.CommandDto)) b: D.CommandDto,
  ) {
    return this.warehouse.restoreWorkZone(id, b);
  }
}
@ApiCookieAuth()
@ApiTags("shipment-work")
@Controller("api/shipments")
export class ShipmentWorkController {
  constructor(
    @Inject(WarehouseService) private readonly warehouse: WarehouseService,
  ) {}
  @Post(":id/work/claim")
  @HttpCode(200)
  @ApiOperation({ operationId: "claimShipmentWork" })
  @ApiParam({ name: "id", type: String })
  @ApiBody({ type: D.ClaimTaskDto })
  @ApiOkResponse({ type: D.WorkspaceDto })
  claimShipmentWork(
    @Param("id") id: string,
    @Body(pipe(D.ClaimTaskDto)) b: D.ClaimTaskDto,
  ) {
    return this.warehouse.claimShipmentWork(id, b);
  }

  @Post(":id/work/scan")
  @HttpCode(200)
  @ApiOperation({ operationId: "scanShipmentWork" })
  @ApiParam({ name: "id", type: String })
  @ApiBody({ type: D.ScanShipmentWorkDto })
  @ApiOkResponse({ type: D.WorkspaceDto })
  scanShipmentWork(
    @Param("id") id: string,
    @Body(pipe(D.ScanShipmentWorkDto)) b: D.ScanShipmentWorkDto,
  ) {
    return this.warehouse.scanShipmentWork(id, b);
  }
  @Post(":id/work/finish")
  @HttpCode(200)
  @ApiOperation({ operationId: "finishShipmentWork" })
  @ApiParam({ name: "id", type: String })
  @ApiBody({ type: D.FinishShipmentWorkDto })
  @ApiOkResponse({ type: D.WorkspaceDto })
  finishShipmentWork(
    @Param("id") id: string,
    @Body(pipe(D.FinishShipmentWorkDto)) b: D.FinishShipmentWorkDto,
  ) {
    return this.warehouse.finishShipmentWork(id, b);
  }
}
