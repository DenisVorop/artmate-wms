import "reflect-metadata";
import {
  Body,
  applyDecorators,
  Inject,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  Param,
  Query,
  Post,
  ValidationPipe,
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import {
  WorkZoneController,
  ShipmentWorkController,
} from "./work-zone.controller";
import { StocktakeController } from "./stocktake.controller";
import { StocktakeService } from "./stocktake.service";
import { AuthController, cookieName } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { requestAuth } from "./auth-context";
import { hashToken } from "./auth-storage";
import { requireAuth } from "./auth-policy";
import { NestFactory } from "@nestjs/core";
import {
  ApiBody,
  ApiCookieAuth,
  ApiQuery,
  ApiParam,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  DocumentBuilder,
  SwaggerModule,
} from "@nestjs/swagger";
import * as D from "./dto";
import { WarehouseService } from "./warehouse.service";

const workforceFilters = () =>
  applyDecorators(
    ApiQuery({ name: "from", required: false, type: String, format: "date" }),
    ApiQuery({ name: "to", required: false, type: String, format: "date" }),
    ApiQuery({ name: "employeeId", required: false, type: String }),
  );
const workforcePaging = () =>
  applyDecorators(
    workforceFilters(),
    ApiQuery({ name: "page", required: false, type: Number }),
    ApiQuery({ name: "pageSize", required: false, type: Number }),
  );
@ApiCookieAuth()
@ApiTags("warehouse")
@Controller("api")
export class WarehouseController {
  constructor(
    @Inject(WarehouseService) private readonly warehouse: WarehouseService,
  ) {}
  @Get("workspace")
  @ApiOperation({ operationId: "getWorkspace" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  getWorkspace() {
    return this.warehouse.snapshot();
  }
  @Get("performance")
  @ApiOperation({ operationId: "getPerformance" })
  @workforceFilters()
  @ApiOkResponse({ type: D.PerformanceReportDto })
  getPerformance(
    @Query(
      new ValidationPipe({
        expectedType: D.PerformanceQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: D.PerformanceQueryDto,
  ) {
    return this.warehouse.getPerformance(query);
  }
  @Get("shifts")
  @ApiOperation({ operationId: "getShiftHistory" })
  @workforcePaging()
  @ApiOkResponse({ type: D.ShiftHistoryPageDto })
  getShiftHistory(
    @Query(
      new ValidationPipe({
        expectedType: D.WorkforceHistoryQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: D.WorkforceHistoryQueryDto,
  ) {
    return this.warehouse.getShiftHistory(query);
  }
  @Get("work-events")
  @ApiOperation({ operationId: "getWorkHistory" })
  @workforcePaging()
  @ApiOkResponse({ type: D.WorkHistoryPageDto })
  getWorkHistory(
    @Query(
      new ValidationPipe({
        expectedType: D.WorkforceHistoryQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: D.WorkforceHistoryQueryDto,
  ) {
    return this.warehouse.getWorkHistory(query);
  }
  @Get("stock-ledger")
  @ApiOperation({ operationId: "getStockLedger" })
  @ApiOkResponse({ type: D.StockLedgerPageDto })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiQuery({ name: "kind", required: false, enum: D.STOCK_LEDGER_KINDS })
  @ApiQuery({ name: "skuId", required: false, type: String })
  @ApiQuery({ name: "employeeId", required: false, type: String })
  @ApiQuery({ name: "from", required: false, type: String })
  @ApiQuery({ name: "to", required: false, type: String })
  @ApiQuery({ name: "search", required: false, type: String })
  getStockLedger(
    @Query(
      new ValidationPipe({
        expectedType: D.StockLedgerQueryDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    query: D.StockLedgerQueryDto,
  ) {
    return this.warehouse.getStockLedger(query);
  }
  @Post("stock-adjustments")
  @HttpCode(200)
  @ApiOperation({ operationId: "adjustStock" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.AdjustStockDto })
  adjustStock(
    @Body(
      new ValidationPipe({
        expectedType: D.AdjustStockDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.AdjustStockDto,
  ) {
    return this.warehouse.adjustStock(body);
  }
  @Post("locations")
  @HttpCode(200)
  @ApiOperation({ operationId: "createLocation" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CreateLocationDto })
  createLocation(
    @Body(
      new ValidationPipe({
        expectedType: D.CreateLocationDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CreateLocationDto,
  ) {
    return this.warehouse.createLocation(body);
  }
  @Post("locations/:id")
  @HttpCode(200)
  @ApiOperation({ operationId: "updateLocation" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.UpdateLocationDto })
  @ApiParam({ name: "id", type: String })
  updateLocation(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.UpdateLocationDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.UpdateLocationDto,
  ) {
    return this.warehouse.updateLocation(id, body);
  }
  @Post("receipts")
  @HttpCode(200)
  @ApiOperation({ operationId: "createReceipt" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CreateReceiptDto })
  createReceipt(
    @Body(
      new ValidationPipe({
        expectedType: D.CreateReceiptDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CreateReceiptDto,
  ) {
    return this.warehouse.createReceipt(body);
  }
  @Post("receipts/:id/pallets/:palletId/place")
  @HttpCode(200)
  @ApiOperation({ operationId: "placeReceiptPallet" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.PlaceReceiptPalletDto })
  @ApiParam({ name: "id", type: String })
  @ApiParam({ name: "palletId", type: String })
  placeReceiptPallet(
    @Param("id") id: string,
    @Param("palletId") palletId: string,
    @Body(
      new ValidationPipe({
        expectedType: D.PlaceReceiptPalletDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.PlaceReceiptPalletDto,
  ) {
    return this.warehouse.placeReceiptPallet(id, palletId, body);
  }
  @Get("receipts/:id/pallets/:palletId/placement-options")
  @ApiOperation({ operationId: "getReceiptPlacementOptions" })
  @ApiOkResponse({ type: D.ReceiptPlacementOptionsDto })
  @ApiParam({ name: "id", type: String })
  @ApiParam({ name: "palletId", type: String })
  getReceiptPlacementOptions(
    @Param("id") id: string,
    @Param("palletId") palletId: string,
  ) {
    return this.warehouse.getReceiptPlacementOptions(id, palletId);
  }
  @Get("receipts/:id/labels")
  @ApiOperation({ operationId: "getReceiptLabels" })
  @ApiOkResponse({ type: D.ReceiptLabelsDto })
  @ApiParam({ name: "id", type: String })
  getReceiptLabels(@Param("id") id: string) {
    return this.warehouse.getReceiptLabels(id);
  }
  @Post("employees")
  @HttpCode(200)
  @ApiOperation({ operationId: "createEmployee" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CreateEmployeeDto })
  createEmployee(
    @Body(
      new ValidationPipe({
        expectedType: D.CreateEmployeeDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CreateEmployeeDto,
  ) {
    return this.warehouse.createEmployee(body);
  }
  @Get("putaway-tasks/:id/placement-options")
  @ApiOperation({ operationId: "getPutawayPlacementOptions" })
  @ApiOkResponse({ type: D.PutawayPlacementOptionsDto })
  @ApiParam({ name: "id", type: String })
  getPutawayPlacementOptions(@Param("id") id: string) {
    return this.warehouse.getPutawayPlacementOptions(id);
  }
  @Post("putaway-tasks/:id/claim")
  @HttpCode(200)
  @ApiOperation({ operationId: "claimPutawayTask" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.ClaimPutawayTaskDto })
  @ApiParam({ name: "id", type: String })
  claimPutawayTask(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.ClaimPutawayTaskDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.ClaimPutawayTaskDto,
  ) {
    return this.warehouse.claimPutawayTask(id, body);
  }
  @Post("putaway-tasks/:id/take")
  @HttpCode(200)
  @ApiOperation({ operationId: "takePutawayTask" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.ConfirmPutawayTaskDto })
  @ApiParam({ name: "id", type: String })
  takePutawayTask(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.ConfirmPutawayTaskDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.ConfirmPutawayTaskDto,
  ) {
    return this.warehouse.takePutawayTask(id, body);
  }
  @Post("putaway-tasks/:id/place")
  @HttpCode(200)
  @ApiOperation({ operationId: "placePutawayTask" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.ConfirmPutawayTaskDto })
  @ApiParam({ name: "id", type: String })
  placePutawayTask(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.ConfirmPutawayTaskDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.ConfirmPutawayTaskDto,
  ) {
    return this.warehouse.placePutawayTask(id, body);
  }
  @Post("putaway-tasks/:id/release")
  @HttpCode(200)
  @ApiOperation({ operationId: "releasePutawayTask" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.ClaimPutawayTaskDto })
  @ApiParam({ name: "id", type: String })
  releasePutawayTask(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.ClaimPutawayTaskDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.ClaimPutawayTaskDto,
  ) {
    return this.warehouse.releasePutawayTask(id, body);
  }
  @Post("tasks")
  @HttpCode(200)
  @ApiOperation({ operationId: "createTask" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CreateTaskDto })
  createTask(
    @Body(
      new ValidationPipe({
        expectedType: D.CreateTaskDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CreateTaskDto,
  ) {
    return this.warehouse.createTask(body);
  }
  @Post("tasks/:id/claim")
  @HttpCode(200)
  @ApiOperation({ operationId: "claimTask" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.ClaimTaskDto })
  @ApiParam({ name: "id", type: String })
  claimTask(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.ClaimTaskDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.ClaimTaskDto,
  ) {
    return this.warehouse.claimTask(id, body);
  }
  @Post("tasks/:id/assignment")
  @HttpCode(200)
  @ApiOperation({ operationId: "assignTask" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.AssignTaskDto })
  @ApiParam({ name: "id", type: String })
  assignTask(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.AssignTaskDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.AssignTaskDto,
  ) {
    return this.warehouse.assignTask(id, body);
  }
  @Post("tasks/:id/scan")
  @HttpCode(200)
  @ApiOperation({ operationId: "scanTask" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.ScanTaskDto })
  @ApiParam({ name: "id", type: String })
  scanTask(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.ScanTaskDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.ScanTaskDto,
  ) {
    return this.warehouse.scanTask(id, body);
  }
  @Post("tasks/:id/pack")
  @HttpCode(200)
  @ApiOperation({ operationId: "packTask" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.PackTaskDto })
  @ApiParam({ name: "id", type: String })
  packTask(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.PackTaskDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.PackTaskDto,
  ) {
    return this.warehouse.packTask(id, body);
  }
  @Post("tasks/:id/status")
  @HttpCode(200)
  @ApiOperation({ operationId: "updateTaskStatus" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.UpdateTaskStatusDto })
  @ApiParam({ name: "id", type: String })
  updateTaskStatus(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.UpdateTaskStatusDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.UpdateTaskStatusDto,
  ) {
    return this.warehouse.updateTaskStatus(id, body);
  }
  @Post("shipments")
  @HttpCode(200)
  @ApiOperation({ operationId: "createShipment" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CreateShipmentDto })
  createShipment(
    @Body(
      new ValidationPipe({
        expectedType: D.CreateShipmentDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CreateShipmentDto,
  ) {
    return this.warehouse.createShipment(body);
  }
  @Post("shipments/:id/ship")
  @HttpCode(200)
  @ApiOperation({ operationId: "shipShipment" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CommandDto })
  @ApiParam({ name: "id", type: String })
  shipShipment(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.CommandDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CommandDto,
  ) {
    return this.warehouse.shipShipment(id, body);
  }
  @Post("employees/:id/shift")
  @HttpCode(200)
  @ApiOperation({ operationId: "updateEmployeeShift" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.UpdateShiftDto })
  @ApiParam({ name: "id", type: String })
  updateEmployeeShift(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.UpdateShiftDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.UpdateShiftDto,
  ) {
    return this.warehouse.updateShift(id, body);
  }
  @Post("rack-sections")
  @HttpCode(200)
  @ApiOperation({ operationId: "createRackSection" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CreateRackSectionDto })
  createRackSection(
    @Body(
      new ValidationPipe({
        expectedType: D.CreateRackSectionDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CreateRackSectionDto,
  ) {
    return this.warehouse.createRackSection(body);
  }
  @Post("rack-sections/:id")
  @HttpCode(200)
  @ApiOperation({ operationId: "updateRackSection" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.UpdateRackSectionDto })
  @ApiParam({ name: "id", type: String })
  updateRackSection(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.UpdateRackSectionDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.UpdateRackSectionDto,
  ) {
    return this.warehouse.updateRackSection(id, body);
  }
  @Post("rack-sections/:id/copy")
  @HttpCode(200)
  @ApiOperation({
    operationId: "copyRackSection",
    description:
      "Создаёт пустую копию активной секции со всеми активными ярусами в новых координатах. Сервер назначает новые коды, названия, ID и QR; товар и резервы остаются в исходных адресах. Архивные ярусы не восстанавливаются.",
  })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CopyRackSectionDto })
  @ApiParam({ name: "id", type: String })
  copyRackSection(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.CopyRackSectionDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CopyRackSectionDto,
  ) {
    return this.warehouse.copyRackSection(id, body);
  }
  @Post("rack-sections/:id/levels")
  @HttpCode(200)
  @ApiOperation({ operationId: "createRackLevel" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CreateRackLevelDto })
  @ApiParam({ name: "id", type: String })
  createRackLevel(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.CreateRackLevelDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CreateRackLevelDto,
  ) {
    return this.warehouse.createRackLevel(id, body);
  }
  @Post("skus/:id/packaging")
  @HttpCode(200)
  @ApiOperation({ operationId: "updateSkuPackaging" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.UpdateSkuPackagingDto })
  @ApiParam({ name: "id", type: String })
  updateSkuPackaging(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.UpdateSkuPackagingDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.UpdateSkuPackagingDto,
  ) {
    return this.warehouse.updateSkuPackaging(id, body);
  }
  @Post("movements")
  @HttpCode(200)
  @ApiOperation({ operationId: "createMovement" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CreateMovementDto })
  createMovement(
    @Body(
      new ValidationPipe({
        expectedType: D.CreateMovementDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CreateMovementDto,
  ) {
    return this.warehouse.createMovement(body);
  }
  @Post("movements/:id/take")
  @HttpCode(200)
  @ApiOperation({ operationId: "takeMovement" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.ConfirmMovementDto })
  @ApiParam({ name: "id", type: String })
  takeMovement(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.ConfirmMovementDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.ConfirmMovementDto,
  ) {
    return this.warehouse.takeMovement(id, body);
  }
  @Post("movements/:id/place")
  @HttpCode(200)
  @ApiOperation({ operationId: "placeMovement" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.ConfirmMovementDto })
  @ApiParam({ name: "id", type: String })
  placeMovement(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.ConfirmMovementDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.ConfirmMovementDto,
  ) {
    return this.warehouse.placeMovement(id, body);
  }
  @Post("movements/:id/cancel")
  @HttpCode(200)
  @ApiOperation({ operationId: "cancelMovement" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CommandDto })
  @ApiParam({ name: "id", type: String })
  cancelMovement(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.CommandDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CommandDto,
  ) {
    return this.warehouse.cancelMovement(id, body);
  }
  @Post("pallets/:id/retire")
  @HttpCode(200)
  @ApiOperation({ operationId: "retireEmptyPallet" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.RetireEmptyPalletDto })
  @ApiParam({ name: "id", type: String })
  retireEmptyPallet(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.RetireEmptyPalletDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.RetireEmptyPalletDto,
  ) {
    return this.warehouse.retireEmptyPallet(id, body);
  }
  @Post("warehouse")
  @HttpCode(200)
  @ApiOperation({ operationId: "updateWarehousePlan" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.UpdateWarehousePlanDto })
  updateWarehousePlan(
    @Body(
      new ValidationPipe({
        expectedType: D.UpdateWarehousePlanDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.UpdateWarehousePlanDto,
  ) {
    return this.warehouse.updateWarehousePlan(body);
  }
  @Post("aisles")
  @HttpCode(200)
  @ApiOperation({ operationId: "createAisle" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CreateAisleDto })
  createAisle(
    @Body(
      new ValidationPipe({
        expectedType: D.CreateAisleDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CreateAisleDto,
  ) {
    return this.warehouse.createAisle(body);
  }
  @Post("aisles/:id")
  @HttpCode(200)
  @ApiOperation({ operationId: "updateAisle" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.UpdateAisleDto })
  @ApiParam({ name: "id", type: String })
  updateAisle(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.UpdateAisleDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.UpdateAisleDto,
  ) {
    return this.warehouse.updateAisle(id, body);
  }
  @Post("entrances")
  @HttpCode(200)
  @ApiOperation({ operationId: "createEntrance" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CreateEntranceDto })
  createEntrance(
    @Body(
      new ValidationPipe({
        expectedType: D.CreateEntranceDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CreateEntranceDto,
  ) {
    return this.warehouse.createEntrance(body);
  }
  @Post("entrances/:id")
  @HttpCode(200)
  @ApiOperation({ operationId: "updateEntrance" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.UpdateEntranceDto })
  @ApiParam({ name: "id", type: String })
  updateEntrance(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.UpdateEntranceDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.UpdateEntranceDto,
  ) {
    return this.warehouse.updateEntrance(id, body);
  }
  @Post("locations/:id/delete")
  @HttpCode(200)
  @ApiOperation({ operationId: "deleteLocation" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CommandDto })
  @ApiParam({ name: "id", type: String })
  deleteLocation(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.CommandDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CommandDto,
  ) {
    return this.warehouse.deleteLocation(id, body);
  }
  @Post("locations/:id/restore")
  @HttpCode(200)
  @ApiOperation({ operationId: "restoreLocation" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CommandDto })
  @ApiParam({ name: "id", type: String })
  restoreLocation(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.CommandDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CommandDto,
  ) {
    return this.warehouse.restoreLocation(id, body);
  }
  @Post("rack-sections/:id/delete")
  @HttpCode(200)
  @ApiOperation({ operationId: "deleteRackSection" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CommandDto })
  @ApiParam({ name: "id", type: String })
  deleteRackSection(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.CommandDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CommandDto,
  ) {
    return this.warehouse.deleteRackSection(id, body);
  }
  @Post("rack-sections/:id/restore")
  @HttpCode(200)
  @ApiOperation({ operationId: "restoreRackSection" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CommandDto })
  @ApiParam({ name: "id", type: String })
  restoreRackSection(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.CommandDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CommandDto,
  ) {
    return this.warehouse.restoreRackSection(id, body);
  }
  @Post("aisles/:id/delete")
  @HttpCode(200)
  @ApiOperation({ operationId: "deleteAisle" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CommandDto })
  @ApiParam({ name: "id", type: String })
  deleteAisle(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.CommandDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CommandDto,
  ) {
    return this.warehouse.deleteAisle(id, body);
  }
  @Post("aisles/:id/restore")
  @HttpCode(200)
  @ApiOperation({ operationId: "restoreAisle" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CommandDto })
  @ApiParam({ name: "id", type: String })
  restoreAisle(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.CommandDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CommandDto,
  ) {
    return this.warehouse.restoreAisle(id, body);
  }
  @Post("entrances/:id/delete")
  @HttpCode(200)
  @ApiOperation({ operationId: "deleteEntrance" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CommandDto })
  @ApiParam({ name: "id", type: String })
  deleteEntrance(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.CommandDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CommandDto,
  ) {
    return this.warehouse.deleteEntrance(id, body);
  }
  @Post("entrances/:id/restore")
  @HttpCode(200)
  @ApiOperation({ operationId: "restoreEntrance" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CommandDto })
  @ApiParam({ name: "id", type: String })
  restoreEntrance(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.CommandDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CommandDto,
  ) {
    return this.warehouse.restoreEntrance(id, body);
  }
  @Post("spaces")
  @HttpCode(200)
  @ApiOperation({ operationId: "createSpace" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CreateSpaceDto })
  createSpace(
    @Body(
      new ValidationPipe({
        expectedType: D.CreateSpaceDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CreateSpaceDto,
  ) {
    return this.warehouse.createSpace(body);
  }
  @Post("spaces/:id")
  @HttpCode(200)
  @ApiOperation({
    operationId: "updateSpace",
    description:
      "Изменяет участок. При изменении X/Y атомарно переносит его активные секции со всеми ярусами, отдельные места и проходы, выбранные по исходной геометрии. Привязанные входы следуют стенам; учётные ссылки и остатки сохраняются.",
  })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.UpdateSpaceDto })
  @ApiParam({ name: "id", type: String })
  updateSpace(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.UpdateSpaceDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.UpdateSpaceDto,
  ) {
    return this.warehouse.updateSpace(id, body);
  }
  @Post("spaces/:id/resize")
  @HttpCode(200)
  @ApiOperation({
    operationId: "resizeSpace",
    description:
      "Изменяет только границы помещения или коридора. Даже при изменении X/Y объекты не перемещаются: прежнее содержимое должно остаться в том же участке. Проверяет весь конечный план и входы атомарно.",
  })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.ResizeSpaceDto })
  @ApiParam({ name: "id", type: String })
  resizeSpace(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.ResizeSpaceDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.ResizeSpaceDto,
  ) {
    return this.warehouse.resizeSpace(id, body);
  }
  @Post("spaces/:id/delete")
  @HttpCode(200)
  @ApiOperation({ operationId: "deleteSpace" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CommandDto })
  @ApiParam({ name: "id", type: String })
  deleteSpace(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.CommandDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CommandDto,
  ) {
    return this.warehouse.deleteSpace(id, body);
  }
  @Post("spaces/:id/restore")
  @HttpCode(200)
  @ApiOperation({ operationId: "restoreSpace" })
  @ApiOkResponse({ type: D.WorkspaceDto })
  @ApiBody({ type: D.CommandDto })
  @ApiParam({ name: "id", type: String })
  restoreSpace(
    @Param("id") id: string,
    @Body(
      new ValidationPipe({
        expectedType: D.CommandDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: D.CommandDto,
  ) {
    return this.warehouse.restoreSpace(id, body);
  }
  @Get("labels/:type/:id")
  @ApiOperation({ operationId: "getLabel" })
  @ApiOkResponse({ type: D.LabelDto })
  @ApiParam({ name: "type", enum: ["location", "pallet", "box", "work-zone"] })
  @ApiParam({ name: "id", type: String })
  getLabel(@Param("type") type: string, @Param("id") id: string) {
    return this.warehouse.getLabel(type, id);
  }
}
@Catch()
class JsonExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const data = error instanceof HttpException ? error.getResponse() : null;
    const message =
      typeof data === "string"
        ? data
        : typeof data === "object" && data && "message" in data
          ? (data as { message: unknown }).message
          : "Внутренняя ошибка сервера";
    if (status === 500) console.error(error);
    response.status(status).json({
      statusCode: status,
      message,
      error:
        status === 500
          ? "Internal Server Error"
          : "Warehouse operation rejected",
    });
  }
}
@Module({
  controllers: [
    WarehouseController,
    AuthController,
    StocktakeController,
    WorkZoneController,
    ShipmentWorkController,
  ],
  providers: [
    WarehouseService,
    AuthService,
    StocktakeService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
export async function createApp() {
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === "test" ? false : ["error", "warn", "log"],
  });
  app.use((request: any, response: any, next: () => void) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    const value = (request.headers.cookie ?? "")
      .split(";")
      .map((p: string) => p.trim())
      .find((p: string) => p.startsWith(`${cookieName()}=`))
      ?.slice(cookieName().length + 1);
    const token =
      typeof value === "string" && /^[a-zA-Z0-9_-]{43}$/.test(value)
        ? value
        : null;
    requestAuth.run(
      {
        http: true,
        tokenHash: token ? hashToken(token) : null,
        csrfToken:
          typeof request.headers["x-wms-csrf"] === "string"
            ? request.headers["x-wms-csrf"]
            : null,
        origin:
          typeof request.headers.origin === "string"
            ? request.headers.origin
            : null,
      },
      next,
    );
  });
  app.use(
    ["/api/docs", "/api/docs-json", "/api/docs-yaml"],
    async (_request: any, response: any, next: () => void) => {
      try {
        await app.get(WarehouseService).authTransaction(async (tx) => {
          const row = await requireAuth(tx);
          if (row.role !== "manager")
            throw new HttpException("Нужны права руководителя", 403);
        });
        next();
      } catch (error) {
        response
          .status(error instanceof HttpException ? error.getStatus() : 500)
          .json({ message: "Войдите как руководитель" });
      }
    },
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new JsonExceptionFilter());
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(",") ?? [
      "http://127.0.0.1:3080",
      "http://127.0.0.1:3081",
      "http://localhost:3080",
      "http://localhost:3081",
    ],
    credentials: true,
  });
  app.enableShutdownHooks();
  return app;
}
export function buildOpenApi(app: Awaited<ReturnType<typeof createApp>>) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Artmate WMS API")
      .setDescription(
        "Локальная WMS: FIFO по дате поступления, складские команды идемпотентны по requestId. Вход: непрозрачная HttpOnly SameSite=Strict cookie; getAuthSession возвращает собственный CSRF-токен. Все аутентифицированные записи требуют разрешённый Origin и X-WMS-CSRF. Login/setup дополнительно требуют JSON и X-WMS-Request: 1. Аккаунты и количественный журнал доступны руководителю; рабочие операции проверяют текущего сотрудника и назначение. Пароли и session tokens не возвращаются в JSON.",
      )
      .addCookieAuth(cookieName(), { type: "apiKey", in: "cookie" }, "cookie")
      .setVersion("0.1.0")
      .build(),
  );
}
