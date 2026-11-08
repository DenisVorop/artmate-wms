import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ValidateIf,
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
export class PlanningStockEntryDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  skuId!: string;
  @ApiProperty({ type: Boolean }) @IsBoolean() enabled!: boolean;
  @ApiProperty({ type: Number, nullable: true })
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(100000000)
  units!: number | null;
  @ApiProperty({ type: String, enum: ["exact", "approximate"] })
  @IsIn(["exact", "approximate"])
  accuracy!: "exact" | "approximate";
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note!: string;
}
export class SetMarketplaceResolutionDto extends MarketplaceCommandDto {
  @ApiProperty({
    type: String,
    enum: ["exclude_supply", "zero_stock", "launch"],
  })
  @IsIn(["exclude_supply", "zero_stock", "launch"])
  kind!: "exclude_supply" | "zero_stock" | "launch";
  @ApiProperty({ type: String, enum: MARKETPLACE_PROVIDERS })
  @IsIn(MARKETPLACE_PROVIDERS)
  provider!: "wildberries" | "ozon";
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  externalId?: string;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  supplyId?: string;
  @ApiProperty({ type: Boolean }) @IsBoolean() enabled!: boolean;
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note!: string;
  @ApiPropertyOptional({ type: String, enum: MARKETPLACE_PROVIDERS })
  @IsOptional()
  @IsIn(MARKETPLACE_PROVIDERS)
  donorProvider?: "wildberries" | "ozon";
}
export class MarketplaceResolutionDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({
    type: String,
    enum: ["exclude_supply", "zero_stock", "launch"],
  })
  kind!: "exclude_supply" | "zero_stock" | "launch";
  @ApiProperty({ type: String, enum: MARKETPLACE_PROVIDERS }) provider!:
    | "wildberries"
    | "ozon";
  @ApiProperty({ type: String, nullable: true }) externalId!: string | null;
  @ApiProperty({ type: String, nullable: true }) supplyId!: string | null;
  @ApiProperty({ type: String, nullable: true }) skuId!: string | null;
  @ApiProperty({ type: Boolean }) enabled!: boolean;
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: String }) note!: string;
  @ApiProperty({ type: String, nullable: true, enum: MARKETPLACE_PROVIDERS })
  donorProvider!: "wildberries" | "ozon" | null;
  @ApiProperty({ type: String }) confirmedAt!: string;
  @ApiProperty({ type: String, nullable: true }) expiresAt!: string | null;
  @ApiProperty({ type: Number }) revision!: number;
}
export class PlanningStockConfirmationDto extends PlanningStockEntryDto {
  @ApiProperty({ type: Number }) unitsPerBoxAtCount!: number;
  @ApiProperty({ type: Number }) trackedUnitsAtCount!: number;
  @ApiProperty({ type: String }) countedAt!: string;
  @ApiProperty({ type: Number }) revision!: number;
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
  @ApiPropertyOptional({ type: Number, default: 6, minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dispatchWeekday?: number;
}
export class UpdateMarketplaceSettingsDto extends MarketplaceSettingsDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  requestId!: string;
}
export class CreateMarketplaceTaskDto extends MarketplaceCommandDto {
  @ApiPropertyOptional({
    enum: ["urgent", "backlog"],
    type: String,
    default: "urgent",
  })
  @IsOptional()
  @IsIn(["urgent", "backlog"])
  purpose?: "urgent" | "backlog";
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
export class MarketplacePlanAdviceDto {
  @ApiProperty({
    enum: ["ready", "covered", "raw_shortage", "review"],
    type: String,
  })
  state!: "ready" | "covered" | "raw_shortage" | "review";
  @ApiProperty({ type: String }) message!: string;
  @ApiProperty({
    enum: ["create", "receiving", "integrations", "transit", "none"],
    type: String,
  })
  action!: "create" | "receiving" | "integrations" | "transit" | "none";
}
export class MarketplaceProviderPlanDto {
  @ApiProperty({ type: Number }) expectedSalesUnits30!: number;
  @ApiProperty({ type: Boolean }) salesForecastKnown!: boolean;
  @ApiProperty({ enum: MARKETPLACE_PROVIDERS, type: String }) provider!:
    | "wildberries"
    | "ozon";
  @ApiProperty({ type: Number }) averageDailyUnits!: number;
  @ApiProperty({ type: Number }) targetUnits!: number;
  @ApiProperty({ type: Number, nullable: true }) marketplaceUnits!:
    | number
    | null;
  @ApiProperty({ type: Number, nullable: true }) inTransitUnits!: number | null;
  @ApiProperty({ type: Number }) dispatchUnits!: number;
  @ApiProperty({ type: Number }) dispatchBoxes!: number;
  @ApiProperty({ type: Boolean }) dataComplete!: boolean;
  @ApiProperty({ type: String }) methodLabel!: string;
  @ApiProperty({ type: String }) confidenceLabel!: string;
  @ApiProperty({ type: Boolean }) scenario!: boolean;
}
export class MarketplaceWeeklyProviderDto {
  @ApiProperty({ enum: MARKETPLACE_PROVIDERS, type: String }) provider!:
    | "wildberries"
    | "ozon";
  @ApiProperty({ type: Number }) boxes!: number;
  @ApiProperty({ type: Number }) units!: number;
}
export class MarketplaceWeeklyDispatchDto {
  @ApiProperty({ type: String }) date!: string;
  @ApiProperty({ type: Number }) boxes!: number;
  @ApiProperty({ type: Number }) units!: number;
  @ApiProperty({ type: [MarketplaceWeeklyProviderDto] })
  providers!: MarketplaceWeeklyProviderDto[];
}
export class MarketplaceWeeklySalesProviderDto {
  @ApiProperty({ enum: MARKETPLACE_PROVIDERS, type: String }) provider!:
    | "wildberries"
    | "ozon";
  @ApiProperty({ type: Number }) units!: number;
  @ApiProperty({ type: Boolean }) known!: boolean;
}
export class MarketplaceWeeklySalesDto {
  @ApiProperty({ type: String }) from!: string;
  @ApiProperty({ type: String }) to!: string;
  @ApiProperty({ type: Number }) units!: number;
  @ApiProperty({ type: [MarketplaceWeeklySalesProviderDto] })
  providers!: MarketplaceWeeklySalesProviderDto[];
}
export class MarketplacePlanRowDto {
  @ApiProperty({ type: Number }) expectedSalesUnits30!: number;
  @ApiProperty({ type: Boolean }) salesForecastKnown!: boolean;
  @ApiProperty({ type: [MarketplaceWeeklySalesDto] })
  weeklySales!: MarketplaceWeeklySalesDto[];
  @ApiProperty({ type: Number }) monthlyOutboundBoxes!: number;
  @ApiProperty({ type: Number }) monthlyOutboundUnits!: number;
  @ApiProperty({ type: Number }) monthlyDispatchShortageUnits!: number;
  @ApiProperty({ type: Number }) localAfterPlannedDispatchUnits!: number;
  @ApiProperty({ type: [MarketplaceWeeklyDispatchDto] })
  weeklyDispatches!: MarketplaceWeeklyDispatchDto[];
  @ApiProperty({ type: [MarketplaceProviderPlanDto] })
  providers!: MarketplaceProviderPlanDto[];
  @ApiProperty({ type: Number }) outboundBoxes!: number;
  @ApiProperty({ type: Number }) outboundUnits!: number;
  @ApiProperty({ type: Number }) newOutboundBoxes!: number;
  @ApiProperty({ type: Number }) newOutboundUnits!: number;
  @ApiProperty({ type: Number }) localAfterDispatchUnits!: number;
  @ApiProperty({ type: Number }) dispatchShortageUnits!: number;
  @ApiProperty({ type: Number }) assemblyShortageUnits!: number;
  @ApiProperty({ type: Number }) localAfterAssemblyUnits!: number;
  @ApiProperty({ type: Number, nullable: true }) backlogRank!: number | null;
  @ApiProperty({ type: Boolean }) backlogCanCreate!: boolean;
  @ApiProperty({ type: Number }) backlogBoxes!: number;
  @ApiProperty({ type: Number }) backlogUnits!: number;
  @ApiProperty({ type: Boolean }) backlogCapacityKnown!: boolean;
  @ApiProperty({ type: String }) backlogReason!: string;
  @ApiProperty({ type: Number }) unregisteredUnits!: number;
  @ApiProperty({ type: String, nullable: true }) stockConfirmedAt!:
    | string
    | null;
  @ApiProperty({ type: Boolean }) stockEstimated!: boolean;
  @ApiProperty({ type: MarketplacePlanAdviceDto })
  advice!: MarketplacePlanAdviceDto;
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
  @ApiProperty({ type: Number }) preparationDays!: number;
  @ApiProperty({ type: String }) preparationThrough!: string;
  @ApiProperty({ type: String }) backlogMessage!: string;
  @ApiProperty({ type: String }) dispatchDate!: string;
  @ApiProperty({ type: Number }) leadDays!: number;
  @ApiProperty({ type: Number }) horizonDays!: number;
  @ApiProperty({ type: Number }) safetyDays!: number;
  @ApiProperty({ type: String }) generatedAt!: string;
  @ApiProperty({ type: [MarketplacePlanRowDto] })
  rows!: MarketplacePlanRowDto[];
  @ApiProperty({ type: [String] }) warnings!: string[];
}
export class MarketplacePlanStatusDto {
  @ApiProperty({
    type: String,
    enum: ["current", "refreshing", "previous", "unavailable"],
  })
  state!: "current" | "refreshing" | "previous" | "unavailable";
  @ApiProperty({ type: String, nullable: true }) calculatedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) dataUpdatedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) salesThrough!: string | null;
  @ApiProperty({ type: String }) message!: string;
}
export class MarketplaceOverviewDto {
  @ApiProperty({ type: [MarketplaceResolutionDto] })
  resolutions!: MarketplaceResolutionDto[];
  @ApiProperty({ type: [PlanningStockConfirmationDto] })
  planningStock!: PlanningStockConfirmationDto[];
  @ApiProperty({ type: [MarketplaceConnectionDto] })
  connections!: MarketplaceConnectionDto[];
  @ApiProperty({ type: [MarketplaceSupplyDto] })
  supplies!: MarketplaceSupplyDto[];
  @ApiProperty({ type: [MarketplaceProductDto] })
  products!: MarketplaceProductDto[];
  @ApiProperty({ type: MarketplaceSettingsDto })
  settings!: MarketplaceSettingsDto;
  @ApiProperty({ type: MarketplacePlanDto }) plan!: MarketplacePlanDto;
  @ApiProperty({ type: MarketplacePlanDto, nullable: true })
  previousPlan!: MarketplacePlanDto | null;
  @ApiProperty({ type: MarketplacePlanStatusDto })
  planStatus!: MarketplacePlanStatusDto;
}
export class MarketplaceTaskResultDto {
  @ApiProperty({ type: String }) taskId!: string;
  @ApiProperty({ type: MarketplaceOverviewDto })
  overview!: MarketplaceOverviewDto;
}
