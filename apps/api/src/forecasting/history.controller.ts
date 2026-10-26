import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { ForecastHistoryService } from "./history.service";
import * as D from "./history.dto";
@ApiCookieAuth()
@ApiTags("forecast")
@Controller("api/forecast/history")
export class ForecastHistoryController {
  constructor(
    @Inject(ForecastHistoryService)
    private readonly service: ForecastHistoryService,
  ) {}
  @Get()
  @ApiOperation({ operationId: "getForecastHistory" })
  @ApiOkResponse({ type: D.ForecastHistoryOverviewDto })
  getForecastHistory() {
    return this.service.getForecastHistory();
  }
  @Get("series")
  @ApiOperation({ operationId: "getForecastHistorySeries" })
  @ApiQuery({ name: "skuId", type: String })
  @ApiOkResponse({ type: [D.ForecastHistorySeriesDto] })
  getForecastHistorySeries(@Query("skuId") skuId: string) {
    return this.service.getForecastHistorySeries(skuId);
  }
  @Post("finance")
  @HttpCode(200)
  @ApiOperation({ operationId: "connectForecastFinance" })
  @ApiBody({ type: D.ConnectForecastFinanceDto })
  @ApiOkResponse({ type: D.ForecastHistoryOverviewDto })
  connectForecastFinance(
    @Body(
      new ValidationPipe({
        expectedType: D.ConnectForecastFinanceDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    b: D.ConnectForecastFinanceDto,
  ) {
    return this.service.connectForecastFinance(b);
  }
  @Post("backfill")
  @HttpCode(200)
  @ApiOperation({ operationId: "startForecastHistory" })
  @ApiBody({ type: D.StartForecastHistoryDto })
  @ApiOkResponse({ type: D.ForecastHistoryOverviewDto })
  startForecastHistory(
    @Body(
      new ValidationPipe({
        expectedType: D.StartForecastHistoryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    b: D.StartForecastHistoryDto,
  ) {
    return this.service.startForecastHistory(b);
  }
}
