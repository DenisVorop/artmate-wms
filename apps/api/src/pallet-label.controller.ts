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
import { PalletLabelService } from "./pallet-label.service";
const pipe = (type: new () => unknown) =>
  new ValidationPipe({
    expectedType: type,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
@ApiCookieAuth()
@ApiTags("pallet-labels")
@Controller("api/pallet-label-batches")
export class PalletLabelController {
  constructor(
    @Inject(PalletLabelService) private readonly service: PalletLabelService,
  ) {}
  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: "createPalletLabelBatch" })
  @ApiBody({ type: D.CreatePalletLabelBatchDto })
  @ApiOkResponse({ type: D.PalletLabelBatchDto })
  createPalletLabelBatch(
    @Body(pipe(D.CreatePalletLabelBatchDto)) b: D.CreatePalletLabelBatchDto,
  ) {
    return this.service.createPalletLabelBatch(b);
  }
  @Get()
  @ApiOperation({ operationId: "getPalletLabelBatches" })
  @ApiOkResponse({ type: D.PalletLabelBatchListDto })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  getPalletLabelBatches(
    @Query(pipe(D.PalletLabelBatchQueryDto)) q: D.PalletLabelBatchQueryDto,
  ) {
    return this.service.getPalletLabelBatches(q);
  }
  @Get(":id")
  @ApiOperation({ operationId: "getPalletLabelBatch" })
  @ApiOkResponse({ type: D.PalletLabelBatchDto })
  @ApiParam({ name: "id", type: String })
  getPalletLabelBatch(@Param("id") id: string) {
    return this.service.getPalletLabelBatch(id);
  }
  @Get(":id/labels")
  @ApiOperation({ operationId: "getPalletLabelBatchLabels" })
  @ApiOkResponse({ type: D.PalletLabelPageDto })
  @ApiParam({ name: "id", type: String })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiQuery({ name: "status", required: false, enum: ["free", "assigned"] })
  getPalletLabelBatchLabels(
    @Param("id") id: string,
    @Query(pipe(D.PalletLabelQueryDto)) q: D.PalletLabelQueryDto,
  ) {
    return this.service.getPalletLabelBatchLabels(id, q);
  }
}
