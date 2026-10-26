import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { ForecastService } from "./forecast-service";
import { ForecastOverviewDto, UpdateForecastPolicyDto } from "./forecast-dto";
@ApiCookieAuth()
@ApiTags("forecast")
@Controller("api/forecast")
export class ForecastController {
  constructor(
    @Inject(ForecastService) private readonly service: ForecastService,
  ) {}
  @Get()
  @ApiOperation({ operationId: "getForecastOverview" })
  @ApiOkResponse({ type: ForecastOverviewDto })
  getForecastOverview() {
    return this.service.getForecastOverview();
  }
  @Post("policy")
  @HttpCode(200)
  @ApiOperation({ operationId: "updateForecastPolicy" })
  @ApiBody({ type: UpdateForecastPolicyDto })
  @ApiOkResponse({ type: ForecastOverviewDto })
  updateForecastPolicy(
    @Body(
      new ValidationPipe({
        expectedType: UpdateForecastPolicyDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    body: UpdateForecastPolicyDto,
  ) {
    return this.service.updateForecastPolicy(body);
  }
}
