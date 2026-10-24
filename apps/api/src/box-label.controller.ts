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
import { BoxLabelService } from "./box-label.service";
const pipe = (type: new () => unknown) =>
  new ValidationPipe({
    expectedType: type,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
@ApiCookieAuth()
@ApiTags("box-labels")
@Controller("api/box-label-batches")
export class BoxLabelController {
  constructor(
    @Inject(BoxLabelService) private readonly service: BoxLabelService,
  ) {}
  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: "createBoxLabelBatch" })
  @ApiBody({ type: D.CreateBoxLabelBatchDto })
  @ApiOkResponse({ type: D.BoxLabelBatchDto })
  createBoxLabelBatch(
    @Body(pipe(D.CreateBoxLabelBatchDto)) b: D.CreateBoxLabelBatchDto,
  ) {
    return this.service.createBoxLabelBatch(b);
  }
  @Get()
  @ApiOperation({ operationId: "getBoxLabelBatches" })
  @ApiOkResponse({ type: D.BoxLabelBatchListDto })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  getBoxLabelBatches(
    @Query(pipe(D.BoxLabelBatchQueryDto)) q: D.BoxLabelBatchQueryDto,
  ) {
    return this.service.getBoxLabelBatches(q);
  }
  @Get(":id")
  @ApiOperation({ operationId: "getBoxLabelBatch" })
  @ApiOkResponse({ type: D.BoxLabelBatchDto })
  @ApiParam({ name: "id", type: String })
  getBoxLabelBatch(@Param("id") id: string) {
    return this.service.getBoxLabelBatch(id);
  }
  @Get(":id/labels")
  @ApiOperation({ operationId: "getBoxLabelBatchLabels" })
  @ApiOkResponse({ type: D.BoxLabelPageDto })
  @ApiParam({ name: "id", type: String })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiQuery({ name: "status", required: false, enum: ["free", "assigned"] })
  getBoxLabelBatchLabels(
    @Param("id") id: string,
    @Query(pipe(D.BoxLabelQueryDto)) q: D.BoxLabelQueryDto,
  ) {
    return this.service.getBoxLabelBatchLabels(id, q);
  }
}
