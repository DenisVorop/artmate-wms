import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";
import { MARKETPLACE_PROVIDERS } from "../marketplaces/dto";
export const JOURNAL_POINT_STATUSES = [
  "pending",
  "unknown",
  "stockout",
  "same_day",
  "scored",
] as const;
export type JournalPointStatus = (typeof JOURNAL_POINT_STATUSES)[number];
export class ForecastJournalQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  cursor?: string;
}
export class ForecastJournalSummaryDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) generatedAt!: string;
  @ApiProperty({ type: String }) publishedAt!: string;
  @ApiProperty({ type: String }) asOf!: string;
  @ApiProperty({ type: String }) modelVersion!: string;
  @ApiProperty({ type: Number }) seriesCount!: number;
  @ApiProperty({ type: String, nullable: true }) from!: string | null;
  @ApiProperty({ type: String, nullable: true }) to!: string | null;
}
export class ForecastJournalListDto {
  @ApiProperty({ type: [ForecastJournalSummaryDto] })
  runs!: ForecastJournalSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class ForecastJournalComparedPointDto {
  @ApiProperty({ type: String }) date!: string;
  @ApiProperty({ type: Number }) predicted!: number;
  @ApiProperty({ type: Number }) basePredicted!: number;
  @ApiProperty({ type: Number }) factor!: number;
  @ApiProperty({ type: Number, nullable: true }) actual!: number | null;
  @ApiProperty({ type: String, enum: JOURNAL_POINT_STATUSES })
  status!: JournalPointStatus;
}
export class ForecastJournalComparedRowDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) scopeKey!: string;
  @ApiProperty({ type: String }) skuId!: string;
  @ApiProperty({ type: String }) skuName!: string;
  @ApiProperty({ type: String, enum: MARKETPLACE_PROVIDERS }) provider!:
    | "wildberries"
    | "ozon";
  @ApiProperty({ type: String, enum: ["net_ordered"] }) metric!: "net_ordered";
  @ApiProperty({ type: String }) modelLabel!: string;
  @ApiProperty({ type: Boolean }) scenario!: boolean;
  @ApiProperty({ type: [ForecastJournalComparedPointDto] })
  points!: ForecastJournalComparedPointDto[];
  @ApiProperty({ type: Number }) comparablePredicted!: number;
  @ApiProperty({ type: Number }) actual!: number;
  @ApiProperty({ type: Number, nullable: true }) mae!: number | null;
  @ApiProperty({ type: Number, nullable: true }) wape!: number | null;
  /** Signed predicted minus actual; positive means overforecast. */
  @ApiProperty({ type: Number, nullable: true }) bias!: number | null;
  @ApiProperty({ type: Number }) scoredDays!: number;
  @ApiProperty({ type: Number }) pendingDays!: number;
  @ApiProperty({ type: Number }) unknownDays!: number;
  @ApiProperty({ type: Number }) stockoutDays!: number;
}
export class ForecastJournalDetailDto extends ForecastJournalSummaryDto {
  @ApiProperty({ type: String }) evaluatedAsOf!: string;
  @ApiProperty({ type: [ForecastJournalComparedRowDto] })
  rows!: ForecastJournalComparedRowDto[];
}
