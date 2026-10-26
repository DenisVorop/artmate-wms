import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, Matches, MaxLength, MinLength } from "class-validator";
import {
  MarketplaceCommandDto,
  MARKETPLACE_PROVIDERS,
} from "../marketplaces/dto";
export class StartForecastHistoryDto extends MarketplaceCommandDto {
  @ApiProperty({ enum: MARKETPLACE_PROVIDERS, type: String })
  @IsIn(MARKETPLACE_PROVIDERS)
  provider!: "wildberries" | "ozon";
  @ApiProperty({ type: String, example: "2024-01-29" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;
  @ApiProperty({ type: String, example: "2026-10-25" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}
export class ConnectForecastFinanceDto extends MarketplaceCommandDto {
  @ApiProperty({ type: String, writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  apiKey!: string;
}
export class ForecastHistoryQueryDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  skuId!: string;
}
export class ForecastHistoryJobDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ enum: MARKETPLACE_PROVIDERS, type: String }) provider!:
    | "wildberries"
    | "ozon";
  @ApiProperty({ type: String }) from!: string;
  @ApiProperty({ type: String }) to!: string;
  @ApiProperty({ type: String }) loadedThrough!: string;
  @ApiProperty({
    enum: [
      "queued",
      "running",
      "complete",
      "permission_required",
      "paused",
      "failed",
    ],
    type: String,
  })
  status!: string;
  @ApiProperty({ type: String }) message!: string;
  @ApiProperty({ type: Number }) pages!: number;
}
export class ForecastHistoryProviderDto {
  @ApiProperty({ type: Boolean }) financeConfigured!: boolean;
  @ApiProperty({ enum: MARKETPLACE_PROVIDERS, type: String }) provider!:
    | "wildberries"
    | "ozon";
  @ApiProperty({ type: String, nullable: true }) from!: string | null;
  @ApiProperty({ type: String, nullable: true }) to!: string | null;
  @ApiProperty({ type: Number }) knownDays!: number;
  @ApiProperty({ type: Number }) products!: number;
  @ApiProperty({ type: String }) message!: string;
}
export class ForecastHistoryOverviewDto {
  @ApiProperty({ type: [ForecastHistoryProviderDto] })
  providers!: ForecastHistoryProviderDto[];
  @ApiProperty({ type: [ForecastHistoryJobDto] })
  jobs!: ForecastHistoryJobDto[];
}
export class ForecastHistoryPointDto {
  @ApiProperty({ type: String }) date!: string;
  @ApiProperty({ type: Number, nullable: true }) units!: number | null;
  @ApiProperty({ enum: ["available", "out_of_stock", "unknown"], type: String })
  availability!: string;
}
export class ForecastHistorySeriesDto {
  @ApiProperty({ type: String }) skuId!: string;
  @ApiProperty({ type: String }) storeId!: string;
  @ApiProperty({ enum: MARKETPLACE_PROVIDERS, type: String }) provider!:
    | "wildberries"
    | "ozon";
  @ApiProperty({ type: String }) externalId!: string;
  @ApiProperty({
    enum: ["ordered", "cancelled", "sold", "returned"],
    type: String,
  })
  metric!: string;
  @ApiProperty({ type: String }) source!: string;
  @ApiProperty({ type: [ForecastHistoryPointDto] })
  points!: ForecastHistoryPointDto[];
}
