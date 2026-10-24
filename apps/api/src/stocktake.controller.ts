import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  Inject,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiTags,
  ApiCookieAuth,
  ApiOperation,
  ApiOkResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import * as D from "./dto";
import { StocktakeService } from "./stocktake.service";
const pipe = (type: new () => unknown) =>
  new ValidationPipe({
    expectedType: type,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
@ApiCookieAuth()
@ApiTags("stocktakes")
@Controller("api/stocktakes")
export class StocktakeController {
  constructor(
    @Inject(StocktakeService) private readonly service: StocktakeService,
  ) {}
  @Get()
  @ApiOperation({ operationId: "getStocktakes" })
  @ApiOkResponse({ type: D.StocktakeListDto })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiQuery({ name: "bucket", required: false, enum: ["active", "archive"] })
  @ApiQuery({ name: "status", required: false, enum: D.STOCKTAKE_STATUSES })
  getStocktakes(
    @Query(pipe(D.StocktakeListQueryDto)) q: D.StocktakeListQueryDto,
  ) {
    return this.service.getStocktakes(q);
  }
  @Get(":id")
  @ApiOperation({ operationId: "getStocktake" })
  @ApiParam({ name: "id", type: String })
  @ApiOkResponse({ type: D.StocktakeDto })
  getStocktake(@Param("id") id: string) {
    return this.service.getStocktake(id);
  }
  @Get(":id/preview")
  @ApiOperation({ operationId: "getStocktakePreview" })
  @ApiParam({ name: "id", type: String })
  @ApiOkResponse({ type: D.StocktakePreviewDto })
  getStocktakePreview(@Param("id") id: string) {
    return this.service.getStocktakePreview(id);
  }
  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: "createStocktake" })
  @ApiBody({ type: D.CreateStocktakeDto })
  @ApiOkResponse({ type: D.StocktakeDto })
  createStocktake(@Body(pipe(D.CreateStocktakeDto)) b: D.CreateStocktakeDto) {
    return this.service.createStocktake(b);
  }
  @Post(":id/claim")
  @HttpCode(200)
  @ApiOperation({ operationId: "claimStocktake" })
  @ApiParam({ name: "id", type: String })
  @ApiBody({ type: D.StocktakeCommandDto })
  @ApiOkResponse({ type: D.StocktakeDto })
  claimStocktake(
    @Param("id") id: string,
    @Body(pipe(D.StocktakeCommandDto)) b: D.StocktakeCommandDto,
  ) {
    return this.service.claimStocktake(id, b);
  }
  @Post(":id/rows/:locationId/count")
  @HttpCode(200)
  @ApiOperation({ operationId: "countStocktakeLocation" })
  @ApiParam({ name: "id", type: String })
  @ApiParam({ name: "locationId", type: String })
  @ApiBody({ type: D.CountStocktakeLocationDto })
  @ApiOkResponse({ type: D.StocktakeDto })
  countStocktakeLocation(
    @Param("id") id: string,
    @Param("locationId") locationId: string,
    @Body(pipe(D.CountStocktakeLocationDto)) b: D.CountStocktakeLocationDto,
  ) {
    return this.service.countStocktakeLocation(id, locationId, b);
  }
  @Post(":id/rows/:locationId/refresh")
  @HttpCode(200)
  @ApiOperation({ operationId: "refreshStocktakeLocation" })
  @ApiParam({ name: "id", type: String })
  @ApiParam({ name: "locationId", type: String })
  @ApiBody({ type: D.StocktakeCommandDto })
  @ApiOkResponse({ type: D.StocktakeDto })
  refreshStocktakeLocation(
    @Param("id") id: string,
    @Param("locationId") locationId: string,
    @Body(pipe(D.StocktakeCommandDto)) b: D.StocktakeCommandDto,
  ) {
    return this.service.refreshStocktakeLocation(id, locationId, b);
  }
  @Post(":id/submit")
  @HttpCode(200)
  @ApiOperation({ operationId: "submitStocktake" })
  @ApiParam({ name: "id", type: String })
  @ApiBody({ type: D.StocktakeCommandDto })
  @ApiOkResponse({ type: D.StocktakeDto })
  submitStocktake(
    @Param("id") id: string,
    @Body(pipe(D.StocktakeCommandDto)) b: D.StocktakeCommandDto,
  ) {
    return this.service.submitStocktake(id, b);
  }
  @Post(":id/approve")
  @HttpCode(200)
  @ApiOperation({ operationId: "approveStocktake" })
  @ApiParam({ name: "id", type: String })
  @ApiBody({ type: D.ReasonStocktakeDto })
  @ApiOkResponse({ type: D.StocktakeDto })
  approveStocktake(
    @Param("id") id: string,
    @Body(pipe(D.ReasonStocktakeDto)) b: D.ReasonStocktakeDto,
  ) {
    return this.service.approveStocktake(id, b);
  }
  @Post(":id/cancel")
  @HttpCode(200)
  @ApiOperation({ operationId: "cancelStocktake" })
  @ApiParam({ name: "id", type: String })
  @ApiBody({ type: D.ReasonStocktakeDto })
  @ApiOkResponse({ type: D.StocktakeDto })
  cancelStocktake(
    @Param("id") id: string,
    @Body(pipe(D.ReasonStocktakeDto)) b: D.ReasonStocktakeDto,
  ) {
    return this.service.cancelStocktake(id, b);
  }
}
