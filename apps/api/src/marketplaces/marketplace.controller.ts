import {
  Body,
  Controller,
  Get,
  Post,
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
} from "@nestjs/swagger";
import * as D from "./dto";
import { MarketplaceService } from "./marketplace.service";
const pipe = (type: new () => unknown) =>
  new ValidationPipe({
    expectedType: type,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
@ApiCookieAuth()
@ApiTags("marketplaces")
@Controller("api/marketplaces")
export class MarketplaceController {
  constructor(
    @Inject(MarketplaceService) private readonly service: MarketplaceService,
  ) {}
  @Get()
  @ApiOperation({ operationId: "getMarketplaces" })
  @ApiOkResponse({ type: D.MarketplaceOverviewDto })
  getMarketplaces() {
    return this.service.getMarketplaces();
  }
  @Post("resolutions")
  @HttpCode(200)
  @ApiOperation({ operationId: "setMarketplaceResolution" })
  @ApiBody({ type: D.SetMarketplaceResolutionDto })
  @ApiOkResponse({ type: D.MarketplaceOverviewDto })
  setMarketplaceResolution(
    @Body(pipe(D.SetMarketplaceResolutionDto))
    body: D.SetMarketplaceResolutionDto,
  ) {
    return this.service.setMarketplaceResolution(body);
  }
  @Post("connections")
  @HttpCode(200)
  @ApiOperation({ operationId: "connectMarketplace" })
  @ApiBody({ type: D.ConnectMarketplaceDto })
  @ApiOkResponse({ type: D.MarketplaceOverviewDto })
  connectMarketplace(
    @Body(pipe(D.ConnectMarketplaceDto)) b: D.ConnectMarketplaceDto,
  ) {
    return this.service.connectMarketplace(b);
  }
  @Post("connections/toggle")
  @HttpCode(200)
  @ApiOperation({ operationId: "toggleMarketplace" })
  @ApiBody({ type: D.ToggleMarketplaceDto })
  @ApiOkResponse({ type: D.MarketplaceOverviewDto })
  toggleMarketplace(
    @Body(pipe(D.ToggleMarketplaceDto)) b: D.ToggleMarketplaceDto,
  ) {
    return this.service.toggleMarketplace(b);
  }
  @Post("sync")
  @HttpCode(200)
  @ApiOperation({ operationId: "syncMarketplace" })
  @ApiBody({ type: D.SyncMarketplaceDto })
  @ApiOkResponse({ type: D.MarketplaceOverviewDto })
  syncMarketplace(@Body(pipe(D.SyncMarketplaceDto)) b: D.SyncMarketplaceDto) {
    return this.service.syncMarketplace(b);
  }
  @Post("mappings")
  @HttpCode(200)
  @ApiOperation({ operationId: "mapMarketplaceProduct" })
  @ApiBody({ type: D.MapMarketplaceProductDto })
  @ApiOkResponse({ type: D.MarketplaceOverviewDto })
  mapMarketplaceProduct(
    @Body(pipe(D.MapMarketplaceProductDto)) b: D.MapMarketplaceProductDto,
  ) {
    return this.service.mapMarketplaceProduct(b);
  }
  @Post("settings")
  @HttpCode(200)
  @ApiOperation({ operationId: "updateMarketplaceSettings" })
  @ApiBody({ type: D.UpdateMarketplaceSettingsDto })
  @ApiOkResponse({ type: D.MarketplaceOverviewDto })
  updateMarketplaceSettings(
    @Body(pipe(D.UpdateMarketplaceSettingsDto))
    b: D.UpdateMarketplaceSettingsDto,
  ) {
    return this.service.updateMarketplaceSettings(b);
  }
  @Post("transit")
  @HttpCode(200)
  @ApiOperation({ operationId: "setMarketplaceTransit" })
  @ApiBody({ type: D.SetMarketplaceTransitDto })
  @ApiOkResponse({ type: D.MarketplaceOverviewDto })
  setMarketplaceTransit(
    @Body(pipe(D.SetMarketplaceTransitDto)) b: D.SetMarketplaceTransitDto,
  ) {
    return this.service.setMarketplaceTransit(b);
  }
  @Post("tasks")
  @HttpCode(200)
  @ApiOperation({ operationId: "createMarketplaceTask" })
  @ApiBody({ type: D.CreateMarketplaceTaskDto })
  @ApiOkResponse({ type: D.MarketplaceTaskResultDto })
  createMarketplaceTask(
    @Body(pipe(D.CreateMarketplaceTaskDto)) b: D.CreateMarketplaceTaskDto,
  ) {
    return this.service.createMarketplaceTask(b);
  }
}
