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
import { WorkAutomationService } from "./service";
import {
  WorkAutomationStatusDto,
  UpdateWorkAutomationSettingsDto,
} from "./dto";
@ApiCookieAuth()
@ApiTags("work-automation")
@Controller("api/work-automation")
export class WorkAutomationController {
  constructor(
    @Inject(WorkAutomationService)
    private readonly service: WorkAutomationService,
  ) {}
  @Get()
  @ApiOperation({ operationId: "getWorkAutomation" })
  @ApiOkResponse({ type: WorkAutomationStatusDto })
  getWorkAutomation() {
    return this.service.getWorkAutomation();
  }
  @Post("settings")
  @HttpCode(200)
  @ApiOperation({ operationId: "updateWorkAutomationSettings" })
  @ApiBody({ type: UpdateWorkAutomationSettingsDto })
  @ApiOkResponse({ type: WorkAutomationStatusDto })
  updateWorkAutomationSettings(
    @Body(
      new ValidationPipe({
        expectedType: UpdateWorkAutomationSettingsDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    body: UpdateWorkAutomationSettingsDto,
  ) {
    return this.service.updateWorkAutomationSettings(body);
  }
}
