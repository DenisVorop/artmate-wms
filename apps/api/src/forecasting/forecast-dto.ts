import { ApiProperty } from "@nestjs/swagger";
import {
  IsBoolean,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import {
  MarketplaceCommandDto,
  MARKETPLACE_PROVIDERS,
} from "../marketplaces/dto";

export class UpdateForecastPolicyDto extends MarketplaceCommandDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  skuId!: string;
  @ApiProperty({ type: Number, minimum: 0, maximum: 1000 })
  @IsInt()
  @Min(0)
  @Max(1000)
  minimumBoxes!: number;
  @ApiProperty({ type: Boolean }) @IsBoolean() seasonalityEnabled!: boolean;
}
export class ForecastChartPointDto {
  @ApiProperty({ type: String }) date!: string;
  @ApiProperty({ type: Number, nullable: true }) actual!: number | null;
  @ApiProperty({ type: Number, nullable: true }) predicted!: number | null;
}
export class ForecastCandidateDto {
  @ApiProperty({ type: String }) model!: string;
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ type: Boolean }) eligible!: boolean;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: Number, nullable: true }) mae!: number | null;
  @ApiProperty({ type: Number, nullable: true }) wape!: number | null;
  @ApiProperty({ type: Number, nullable: true }) bias!: number | null;
  @ApiProperty({ type: Number }) folds!: number;
}
export class ForecastSourceDto {
  @ApiProperty({ enum: MARKETPLACE_PROVIDERS, type: String }) provider!:
    | "ozon"
    | "wildberries";
  @ApiProperty({ type: String }) metricLabel!: string;
  @ApiProperty({ type: String }) modelLabel!: string;
  @ApiProperty({ type: Number }) predictedUnits!: number;
  @ApiProperty({ type: Number }) historyDays!: number;
  @ApiProperty({ type: [ForecastCandidateDto] })
  candidates!: ForecastCandidateDto[];
  @ApiProperty({ type: [ForecastChartPointDto] })
  points!: ForecastChartPointDto[];
}
export class ForecastRowDto {
  @ApiProperty({ type: String }) skuId!: string;
  @ApiProperty({ type: String }) skuName!: string;
  @ApiProperty({ type: Number }) minimumBoxes!: number;
  @ApiProperty({ type: Boolean }) seasonalityEnabled!: boolean;
  @ApiProperty({ type: Number }) targetUnits!: number;
  @ApiProperty({ type: Boolean }) seasonalityApplied!: boolean;
  @ApiProperty({ type: String }) methodLabel!: string;
  @ApiProperty({ type: String }) confidenceLabel!: string;
  @ApiProperty({ type: String }) message!: string;
  @ApiProperty({ type: String, nullable: true }) historyFrom!: string | null;
  @ApiProperty({ type: String, nullable: true }) historyTo!: string | null;
  @ApiProperty({ type: Number }) knownDays!: number;
  @ApiProperty({ type: [ForecastSourceDto] }) sources!: ForecastSourceDto[];
}
export class ForecastOverviewDto {
  @ApiProperty({ type: Boolean }) ready!: boolean;
  @ApiProperty({ type: Boolean }) computing!: boolean;
  @ApiProperty({ type: String }) message!: string;
  @ApiProperty({ type: String, nullable: true }) generatedAt!: string | null;
  @ApiProperty({ type: [ForecastRowDto] }) rows!: ForecastRowDto[];
}
