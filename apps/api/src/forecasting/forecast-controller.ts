import {
  ForecastJournalDetailDto,
  ForecastJournalListDto,
  ForecastJournalQueryDto,
} from "./journal-dto";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Param,
  Query,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { ForecastService } from "./forecast-service";
import { ForecastOverviewDto, UpdateForecastPolicyDto } from "./forecast-dto";
class ForecastJournalEmptyQueryDto {}
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
  @Get("journal")
  @ApiOperation({ operationId: "getForecastJournal" })
  @ApiOkResponse({ type: ForecastJournalListDto })
  @ApiQuery({
    name: "limit",
    type: Number,
    required: false,
    minimum: 1,
    maximum: 50,
  })
  @ApiQuery({ name: "cursor", type: String, required: false })
  getForecastJournal(
    @Query(
      new ValidationPipe({
        expectedType: ForecastJournalQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: ForecastJournalQueryDto,
  ) {
    return this.service.getForecastJournal(query);
  }
  @Get("journal/:id")
  @ApiOperation({ operationId: "getForecastJournalRun" })
  @ApiOkResponse({ type: ForecastJournalDetailDto })
  @ApiParam({ name: "id", schema: { type: "string", pattern: "^[a-f0-9]{64}$" } })
  getForecastJournalRun(
    @Param("id") id: string,
    @Query(
      new ValidationPipe({
        expectedType: ForecastJournalEmptyQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    _query: ForecastJournalEmptyQueryDto,
  ) {
    return this.service.getForecastJournalRun(id);
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
