import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
export const MARKETPLACE_PROVIDERS = ["wildberries", "ozon"] as const;
export class MarketplaceCommandDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  requestId!: string;
}
export class ConnectMarketplaceDto extends MarketplaceCommandDto {
  @ApiProperty({ enum: MARKETPLACE_PROVIDERS, type: String })
  @IsIn(MARKETPLACE_PROVIDERS)
  provider!: "wildberries" | "ozon";
  @ApiProperty({ type: String, writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  apiKey!: string;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientId?: string;
}
export class ToggleMarketplaceDto extends MarketplaceCommandDto {
  @ApiProperty({ enum: MARKETPLACE_PROVIDERS, type: String })
  @IsIn(MARKETPLACE_PROVIDERS)
  provider!: "wildberries" | "ozon";
  @ApiProperty({ type: Boolean }) @IsBoolean() enabled!: boolean;
}
export class SyncMarketplaceDto extends MarketplaceCommandDto {
  @ApiProperty({ enum: MARKETPLACE_PROVIDERS, type: String })
  @IsIn(MARKETPLACE_PROVIDERS)
  provider!: "wildberries" | "ozon";
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 89, default: 56 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(89)
  historyDays?: number;
}
export class MapMarketplaceProductDto extends MarketplaceCommandDto {
  @ApiProperty({ enum: MARKETPLACE_PROVIDERS, type: String })
  @IsIn(MARKETPLACE_PROVIDERS)
  provider!: "wildberries" | "ozon";
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  externalId!: string;
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  skuId!: string;
  @ApiProperty({ type: Number, minimum: 1, maximum: 10000 })
  @IsInt()
  @Min(1)
  @Max(10000)
  unitsPerItem!: number;
}
export class MarketplaceSettingsDto {
  @ApiProperty({ type: Number, default: 14 })
  @IsInt()
  @Min(1)
  @Max(180)
  horizonDays!: number;
  @ApiProperty({ type: Number, default: 3 })
  @IsInt()
  @Min(0)
  @Max(60)
  safetyDays!: number;
  @ApiProperty({ type: Number, default: 7 })
  @IsInt()
  @Min(0)
  @Max(90)
  leadDays!: number;
  @ApiProperty({ type: Number, default: 28 })
  @IsInt()
  @Min(7)
  @Max(89)
  historyDays!: number;
}
export class UpdateMarketplaceSettingsDto extends MarketplaceSettingsDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  requestId!: string;
}
export class SetMarketplaceTransitDto extends MarketplaceCommandDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  skuId!: string;
  @ApiProperty({ type: Number, minimum: 0, maximum: 100000000 })
  @IsInt()
  @Min(0)
  @Max(100000000)
  inTransitUnits!: number;
}
export class CreateMarketplaceTaskDto extends MarketplaceCommandDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  skuId!: string;
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(64)
  @MaxLength(64)
  proposalHash!: string;
}
export class MarketplaceConnectionDto {
  @ApiProperty({ enum: MARKETPLACE_PROVIDERS, type: String }) provider!:
    | "wildberries"
    | "ozon";
  @ApiProperty({ type: Boolean }) configured!: boolean;
  @ApiProperty({ type: Boolean }) enabled!: boolean;
  @ApiProperty({ type: String, nullable: true }) clientId!: string | null;
  @ApiProperty({
    enum: ["never", "running", "success", "failed", "partial"],
    type: String,
  })
  syncStatus!: "never" | "running" | "success" | "failed" | "partial";
  @ApiProperty({ type: String, nullable: true }) lastSuccessAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) lastAttemptAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) message!: string | null;
  @ApiProperty({ type: [String] }) warnings!: string[];
}
export class MarketplaceProductDto {
  @ApiProperty({ enum: MARKETPLACE_PROVIDERS, type: String }) provider!:
    | "wildberries"
    | "ozon";
  @ApiProperty({ type: String }) externalId!: string;
  @ApiProperty({ type: String, nullable: true }) offerId!: string | null;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: [String] }) barcodes!: string[];
  @ApiProperty({ type: String, nullable: true }) skuId!: string | null;
  @ApiProperty({ type: Number }) unitsPerItem!: number;
  @ApiProperty({ type: String, nullable: true }) suggestedSkuId!: string | null;
}
export class MarketplaceSupplyItemDto {
  @ApiProperty({ type: String }) externalId!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, nullable: true }) skuId!: string | null;
  @ApiProperty({ type: Number, nullable: true }) plannedUnits!: number | null;
  @ApiProperty({ type: Number, nullable: true }) acceptedUnits!: number | null;
  @ApiProperty({ type: Number, nullable: true }) readyUnits!: number | null;
  @ApiProperty({ type: Number, nullable: true }) pendingUnits!: number | null;
}
export class MarketplaceSupplyDto {
  @ApiProperty({ enum: MARKETPLACE_PROVIDERS, type: String }) provider!:
    | "wildberries"
    | "ozon";
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) statusCode!: string;
  @ApiProperty({ type: String }) statusLabel!: string;
  @ApiProperty({ type: String, nullable: true }) expectedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) receivedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) updatedAt!: string | null;
  @ApiProperty({
    enum: ["document", "analytics", "excluded", "review"],
    type: String,
  })
  calculation!: "document" | "analytics" | "excluded" | "review";
  @ApiProperty({ type: [MarketplaceSupplyItemDto] })
  items!: MarketplaceSupplyItemDto[];
  @ApiProperty({ type: [String] }) warnings!: string[];
}
export class MarketplaceInboundSourceDto {
  @ApiProperty({ enum: MARKETPLACE_PROVIDERS, type: String }) provider!:
    | "wildberries"
    | "ozon";
  @ApiProperty({ type: Number, nullable: true }) units!: number | null;
  @ApiProperty({
    enum: ["wb_supplies", "ozon_analytics", "legacy", "unknown"],
    type: String,
  })
  source!: "wb_supplies" | "ozon_analytics" | "legacy" | "unknown";
  @ApiProperty({ type: String, nullable: true }) asOf!: string | null;
  @ApiProperty({ type: Number }) supplyCount!: number;
  @ApiProperty({ type: [String] }) warnings!: string[];
}
export class MarketplacePlanRowDto {
  @ApiProperty({ type: Boolean }) dataComplete!: boolean;
  @ApiProperty({ type: String }) skuId!: string;
  @ApiProperty({ type: String }) skuName!: string;
  @ApiProperty({ type: Number }) unitsPerBox!: number;
  @ApiProperty({ type: Number }) averageDailyUnits!: number;
  @ApiProperty({ type: Number }) targetUnits!: number;
  @ApiProperty({ type: Number }) marketplaceUnits!: number;
  @ApiProperty({ type: Number, nullable: true }) inTransitUnits!: number | null;
  @ApiProperty({ enum: ["api", "manual", "unknown"], type: String })
  inboundSource!: "api" | "manual" | "unknown";
  @ApiProperty({ type: [MarketplaceInboundSourceDto] })
  inboundSources!: MarketplaceInboundSourceDto[];
  @ApiProperty({ type: Number }) readyUnits!: number;
  @ApiProperty({ type: Number }) shippingReadyUnits!: number;
  @ApiProperty({ type: Number }) shipmentReservedUnits!: number;
  @ApiProperty({ type: Number }) openTaskUnits!: number;
  @ApiProperty({ type: Number }) rawAvailableUnits!: number;
  @ApiProperty({ type: Number }) recommendedUnits!: number;
  @ApiProperty({ type: Number }) recommendedBoxes!: number;
  @ApiProperty({ type: Boolean }) canCreate!: boolean;
  @ApiProperty({ type: [String] }) blockers!: string[];
  @ApiProperty({ type: [String] }) warnings!: string[];
  @ApiProperty({ type: String }) proposalHash!: string;
}
export class MarketplacePlanDto {
  @ApiProperty({ type: String }) generatedAt!: string;
  @ApiProperty({ type: [MarketplacePlanRowDto] })
  rows!: MarketplacePlanRowDto[];
  @ApiProperty({ type: [String] }) warnings!: string[];
}
export class MarketplaceOverviewDto {
  @ApiProperty({ type: [MarketplaceConnectionDto] })
  connections!: MarketplaceConnectionDto[];
  @ApiProperty({ type: [MarketplaceSupplyDto] })
  supplies!: MarketplaceSupplyDto[];
  @ApiProperty({ type: [MarketplaceProductDto] })
  products!: MarketplaceProductDto[];
  @ApiProperty({ type: MarketplaceSettingsDto })
  settings!: MarketplaceSettingsDto;
  @ApiProperty({ type: MarketplacePlanDto }) plan!: MarketplacePlanDto;
}
export class MarketplaceTaskResultDto {
  @ApiProperty({ type: String }) taskId!: string;
  @ApiProperty({ type: MarketplaceOverviewDto })
  overview!: MarketplaceOverviewDto;
}
