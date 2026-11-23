import { Transform, Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsInt,
  Min,
  Max,
  ValidateIf,
  IsIn,
  IsBoolean,
  IsNumber,
  MaxLength,
  ValidateNested,
  IsDefined,
  IsObject,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  MinLength,
  IsISO8601,
  Matches,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from "class-validator";

export const WORK_ROUTE_KINDS = [
  "assembly",
  "receiving",
  "putaway",
  "movement",
  "shipping",
] as const;
export class WorkRouteQueryDto {
  @ApiProperty({ enum: WORK_ROUTE_KINDS })
  @IsIn(WORK_ROUTE_KINDS)
  kind!: (typeof WORK_ROUTE_KINDS)[number];
  @ApiProperty({ type: String, maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  id!: string;
  @ApiPropertyOptional({ type: String, maxLength: 160 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  palletId?: string;
  @ApiPropertyOptional({ type: String, maxLength: 160 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  boxId?: string;
}
export class RoutePointDto {
  @ApiProperty({ type: Number }) x!: number;
  @ApiProperty({ type: Number }) y!: number;
}
export class WorkRouteDto {
  @ApiProperty({ type: String, description: "Стабильный ключ геометрии плана" })
  layoutKey!: string;
  @ApiProperty({ type: Number, minimum: 0, format: "int64" }) revision!: number;
  @ApiProperty({ type: String, nullable: true }) sourceLocationId!:
    | string
    | null;
  @ApiProperty({ type: String, nullable: true }) targetLocationId!:
    | string
    | null;
  @ApiProperty({ enum: ["aisles", "floor", "unknown", "unreachable"] })
  status!: "aisles" | "floor" | "unknown" | "unreachable";
  @ApiProperty({ type: Number, nullable: true }) distanceMeters!: number | null;
  @ApiProperty({ type: String }) note!: string;
  @ApiProperty({ type: [RoutePointDto] }) points!: RoutePointDto[];
}

export class LotContentDto {
  @ApiProperty({ type: String }) lotId!: string;
  @ApiProperty({ type: Number }) quantity!: number;
}
export class ReservationDto extends LotContentDto {
  @ApiProperty({ type: String }) palletId!: string;
}

@ValidatorConstraint({ name: "loadDimensionAtLeastBase", async: false })
export class LoadDimensionAtLeastBaseConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    const base = (args.object as Record<string, unknown>)[args.constraints[0]];
    return (
      typeof value === "number" && typeof base === "number" && value >= base
    );
  }
  defaultMessage() {
    return "Габарит загруженной паллеты не может быть меньше поддона";
  }
}

export class PackagingProfileDto {
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(1)
  @Max(5000)
  boxWidthMm!: number;
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(1)
  @Max(5000)
  boxDepthMm!: number;
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(1)
  @Max(5000)
  boxHeightMm!: number;
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(100)
  @Max(5000)
  palletWidthMm!: number;
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(100)
  @Max(5000)
  palletDepthMm!: number;
  @ApiPropertyOptional({
    type: Number,
    minimum: 100,
    maximum: 5000,
    description: "Полная ширина груза с поддоном; по умолчанию ширина поддона",
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(100)
  @Max(5000)
  @Validate(LoadDimensionAtLeastBaseConstraint, ["palletWidthMm"])
  loadWidthMm?: number;
  @ApiPropertyOptional({
    type: Number,
    minimum: 100,
    maximum: 5000,
    description:
      "Полная глубина груза с поддоном; по умолчанию глубина поддона",
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(100)
  @Max(5000)
  @Validate(LoadDimensionAtLeastBaseConstraint, ["palletDepthMm"])
  loadDepthMm?: number;
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(1)
  @Max(1000)
  palletBaseHeightMm!: number;
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(1)
  @Max(500)
  boxesPerLayer!: number;
  @ApiProperty({ type: Number }) @IsInt() @Min(1) @Max(100) maxLayers!: number;
  @ApiProperty({ type: Number, nullable: true })
  @ValidateIf((_o, v) => v !== null)
  @IsNumber()
  @Min(0.001)
  @Max(10000)
  boxWeightKg!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  @ValidateIf((_o, v) => v !== null)
  @IsNumber()
  @Min(0.001)
  @Max(10000)
  palletWeightKg!: number | null;
}

export class PlanArchiveDto {
  @ApiProperty({ type: Boolean }) archived!: boolean;
  @ApiProperty({ type: String, nullable: true }) archivedAt!: string | null;
}
export class WarehouseSpaceDto extends PlanArchiveDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, enum: ["room", "corridor"] }) kind!: string;
  @ApiProperty({ type: Number }) x!: number;
  @ApiProperty({ type: Number }) y!: number;
  @ApiProperty({ type: Number }) width!: number;
  @ApiProperty({ type: Number }) depth!: number;
}
export const WORK_ZONE_KINDS = [
  "receiving",
  "assembly",
  "putaway",
  "shipping",
] as const;
export class WorkZoneDto extends PlanArchiveDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, enum: WORK_ZONE_KINDS }) kind!: string;
  @ApiProperty({ type: [String] }) locationIds!: string[];
}
export class ZoneWorkDto {
  @ApiProperty({ type: String }) employeeId!: string;
  @ApiProperty({ type: String }) zoneId!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ["receiving", "assembly", "putaway", "shipping"],
  })
  jobKind!: string | null;
  @ApiProperty({ type: String, nullable: true }) jobId!: string | null;
  @ApiProperty({ type: String, nullable: true }) palletId!: string | null;
  @ApiPropertyOptional({ type: Boolean }) manualQueue?: boolean;
  @ApiPropertyOptional({ type: Boolean }) locked?: boolean;
  @ApiProperty({ type: String }) message!: string;
}
export const consumableItems = ["individual_box", "transport_carton"] as const;
export type ConsumableItem = (typeof consumableItems)[number];

export class ConsumableQuantityDto {
  @ApiProperty({ type: String }) locationId!: string;
  @ApiProperty({ type: String, enum: consumableItems }) item!: ConsumableItem;
  @ApiProperty({ type: Number }) quantity!: number;
}

export class WarehousePlanDto {
  @ApiPropertyOptional({ type: Boolean })
  consumablesEnabled?: boolean;
  @ApiPropertyOptional({ type: [ConsumableQuantityDto] })
  consumables?: ConsumableQuantityDto[];

  @ApiProperty({ type: [WorkZoneDto] }) workZones!: WorkZoneDto[];
  @ApiProperty({ type: [ZoneWorkDto] }) zoneWork!: ZoneWorkDto[];
  @ApiProperty({ type: String, enum: ["rectangle", "spaces"] })
  layoutMode!: string;
  @ApiProperty({ type: [WarehouseSpaceDto] }) spaces!: WarehouseSpaceDto[];

  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Number }) width!: number;
  @ApiProperty({ type: Number }) depth!: number;
}
export class AisleDto extends PlanArchiveDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Number }) x!: number;
  @ApiProperty({ type: Number }) y!: number;
  @ApiProperty({ type: Number }) width!: number;
  @ApiProperty({ type: Number }) depth!: number;
  @ApiProperty({ type: Number, enum: [0, 90, 180, 270] }) rotation!: number;
}
export class EntranceDto extends PlanArchiveDto {
  @ApiProperty({ type: String, nullable: true }) spaceId!: string | null;
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, enum: ["north", "east", "south", "west"] })
  wall!: string;
  @ApiProperty({ type: Number }) offset!: number;
  @ApiProperty({ type: Number }) width!: number;
}

export class RackSectionDto extends PlanArchiveDto {
  @ApiProperty({ type: Number, enum: [0, 90, 180, 270] }) rotation!: number;
  @ApiProperty({ type: [String] }) archivedLocationIds!: string[];
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Number }) x!: number;
  @ApiProperty({ type: Number }) y!: number;
  @ApiProperty({ type: Number }) width!: number;
  @ApiProperty({ type: Number }) depth!: number;
}
export class MovementDto {
  @ApiPropertyOptional({ type: String, enum: ["accessible_raw"] })
  autoPurpose?: "accessible_raw";
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) palletId!: string;
  @ApiProperty({ type: String }) fromLocationId!: string;
  @ApiProperty({ type: String }) toLocationId!: string;
  @ApiProperty({ type: String, enum: ["transfer", "lower", "return"] })
  kind!: string;
  @ApiProperty({
    type: String,
    enum: ["planned", "in_transit", "completed", "cancelled"],
  })
  status!: string;
  @ApiProperty({ type: String, nullable: true }) employeeId!: string | null;
  @ApiProperty({ type: Boolean }) keepSourceReserved!: boolean;
  @ApiProperty({ type: String }) createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) takenAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) completedAt!: string | null;
}

export class SkuDto {
  @ApiProperty({ type: PackagingProfileDto }) packaging!: PackagingProfileDto;
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) barcode!: string;
  @ApiPropertyOptional({ type: [String] }) alternateBarcodes?: string[];
  @ApiProperty({ type: Number }) unitsPerBox!: number;
  @ApiProperty({ type: String }) color!: string;
}
export class LocationDto extends PlanArchiveDto {
  @ApiProperty({ type: Number, enum: [0, 90, 180, 270] }) rotation!: number;
  @ApiProperty({ type: String, nullable: true }) sectionId!: string | null;
  @ApiProperty({ type: Number }) level!: number;
  @ApiProperty({ type: Number }) availableWidthMm!: number;
  @ApiProperty({ type: Number }) availableDepthMm!: number;
  @ApiProperty({ type: Number, nullable: true }) maxWeightKg!: number | null;
  @ApiProperty({ type: Number }) accessSides!: number;

  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({
    enum: ["rack", "floor", "receiving", "assembly", "shipping", "picking"],
    type: String,
  })
  kind!: string;
  @ApiProperty({ type: Number }) x!: number;
  @ApiProperty({ type: Number }) y!: number;
  @ApiProperty({ type: Number }) width!: number;
  @ApiProperty({ type: Number }) depth!: number;
  @ApiProperty({ type: Number }) levels!: number;
  @ApiProperty({ type: Number }) maxHeightMm!: number;
  @ApiProperty({ type: Number }) maxBoxes!: number;
  @ApiProperty({ type: Boolean }) blocked!: boolean;
}
export class LotDto {
  @ApiPropertyOptional({ type: String }) openingStocktakeId?: string;
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) skuId!: string;
  @ApiProperty({ type: String }) receivedAt!: string;
  @ApiProperty({ type: String }) name!: string;
}
export class PalletDto {
  @ApiPropertyOptional({ type: String }) openingStocktakeId?: string;
  @ApiProperty({ type: Number }) widthMm!: number;
  @ApiProperty({ type: Number }) depthMm!: number;
  @ApiProperty({ type: Number, nullable: true }) weightKg!: number | null;
  @ApiProperty({
    type: String,
    enum: ["stored", "in_transit", "retired", "awaiting_placement"],
  })
  status!: string;
  @ApiProperty({ type: String, nullable: true }) returnLocationId!:
    | string
    | null;
  @ApiProperty({ type: PackagingProfileDto, nullable: true })
  packagingSnapshot!: PackagingProfileDto | null;

  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String, nullable: true }) skuId!: string | null;
  @ApiProperty({ type: String, nullable: true }) lotId!: string | null;
  @ApiProperty({ type: Number }) quantity!: number;
  @ApiProperty({ type: String, nullable: true }) locationId!: string | null;
  @ApiProperty({ enum: ["raw", "finished", "assembly"], type: String })
  kind!: string;
  @ApiProperty({ type: Number }) heightMm!: number;
}
export class BoxDto {
  @ApiPropertyOptional({ type: String }) openingStocktakeId?: string;
  @ApiPropertyOptional({ type: String }) registeredAt?: string;
  @ApiProperty({ type: PackagingProfileDto })
  packagingSnapshot!: PackagingProfileDto;
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) skuId!: string;
  @ApiProperty({ type: Number }) units!: number;
  @ApiProperty({ type: [LotContentDto] }) lotContents!: LotContentDto[];
  @ApiProperty({ type: String, nullable: true }) packedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) locationId!: string | null;
  @ApiProperty({ type: String, nullable: true }) palletId!: string | null;
  @ApiProperty({
    enum: ["stored", "in_transit", "staged", "shipped", "written_off"],
    type: String,
  })
  status!: string;
}
export class TaskDto {
  @ApiPropertyOptional({ type: [ConsumableQuantityDto] })
  consumableReservations?: ConsumableQuantityDto[];

  @ApiPropertyOptional({ type: String, enum: ["urgent", "backlog"] })
  autoPurpose?: "urgent" | "backlog";
  @ApiProperty({ type: String, nullable: true }) createdAt!: string | null;
  @ApiPropertyOptional({ type: String }) startedAt?: string;
  @ApiPropertyOptional({ type: String }) queueOrder?: string;
  @ApiProperty({ type: Boolean }) boxCodeConfirmed!: boolean;
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) skuId!: string;
  @ApiProperty({ type: Number }) boxesTarget!: number;
  @ApiProperty({ type: Number }) boxesCompleted!: number;
  @ApiProperty({ type: Number }) unitsPerBox!: number;
  @ApiProperty({
    enum: ["queued", "active", "paused", "completed"],
    type: String,
  })
  status!: string;
  @ApiProperty({ type: String, nullable: true }) employeeId!: string | null;
  @ApiProperty({ type: Number }) scannedUnits!: number;
  @ApiProperty({ type: String, nullable: true }) sourcePalletId!: string | null;
  @ApiProperty({ type: String }) openBoxCode!: string;
  @ApiProperty({ type: [ReservationDto] }) reservations!: ReservationDto[];
  @ApiProperty({ type: [LotContentDto] }) openBoxContents!: LotContentDto[];
}
export class EmployeeDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) initials!: string;
  @ApiProperty({ type: String }) role!: string;
  @ApiProperty({ enum: ["off", "working", "break"], type: String })
  status!: string;
  @ApiProperty({ type: Number }) boxesToday!: number;
  @ApiProperty({ type: Number }) unitsToday!: number;
}
export class WbShipmentLabelDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) skuId!: string;
  @ApiProperty({ type: Number }) units!: number;
  @ApiPropertyOptional({ type: String }) boxId?: string;
  @ApiPropertyOptional({ type: String }) employeeId?: string;
  @ApiPropertyOptional({ type: String }) scannedAt?: string;
}
export class WbShipmentDto {
  @ApiProperty({ type: String }) supplyId!: string;
  @ApiProperty({ type: String }) storeId!: string;
  @ApiProperty({ type: [WbShipmentLabelDto] }) labels!: WbShipmentLabelDto[];
  @ApiProperty({ type: String, nullable: true }) locationId!: string | null;
  @ApiProperty({ type: String, nullable: true }) pendingBoxId!: string | null;
  @ApiProperty({ type: [String] }) sourceShipmentIds!: string[];
}
export class ShipmentDto {
  @ApiPropertyOptional({ type: WbShipmentDto }) wb?: WbShipmentDto;
  @ApiPropertyOptional({ type: String, enum: ["box"] }) pickingMode?: "box";
  @ApiPropertyOptional({ type: String, nullable: true }) employeeId?:
    | string
    | null;
  @ApiPropertyOptional({ type: String, nullable: true }) workZoneId?:
    | string
    | null;
  @ApiPropertyOptional({ type: [String] }) scannedBoxIds?: string[];

  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) skuId!: string;
  @ApiProperty({ type: Number }) boxesRequested!: number;
  @ApiProperty({ enum: ["draft", "shipped"], type: String }) status!: string;
  @ApiProperty({ type: [String] }) boxIds!: string[];
}
export class ActivityDto {
  @ApiPropertyOptional({ type: String, nullable: true }) actorEmployeeId?:
    | string
    | null;
  @ApiPropertyOptional({ type: String, nullable: true }) actorName?:
    | string
    | null;
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ type: String }) createdAt!: string;
  @ApiProperty({ type: String }) kind!: string;
}
export class ReceiptPalletDto {
  @ApiProperty({ type: String }) palletId!: string;
  @ApiProperty({ type: String }) skuId!: string;
  @ApiProperty({ type: Number }) quantity!: number;
  @ApiProperty({ type: String, nullable: true }) locationId!: string | null;
  @ApiProperty({ type: String, nullable: true }) placedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) placedByEmployeeId!:
    | string
    | null;
}
export class ReceiptDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) receivedAt!: string;
  @ApiProperty({ type: String }) createdAt!: string;
  @ApiProperty({
    type: String,
    enum: ["awaiting_placement", "partially_placed", "completed"],
  })
  status!: string;
  @ApiProperty({ type: String, nullable: true }) completedAt!: string | null;
  @ApiProperty({ type: [ReceiptPalletDto] }) pallets!: ReceiptPalletDto[];
}
export class BalanceDto {
  @ApiProperty({ type: Number }) rawUnits!: number;
  @ApiProperty({ type: Number }) workInProgressUnits!: number;
  @ApiProperty({ type: Number }) boxedUnits!: number;
  @ApiProperty({ type: Number }) totalUnits!: number;
  @ApiProperty({ type: Number }) awaitingPlacementUnits!: number;
  @ApiProperty({ type: Number }) awaitingPlacementPallets!: number;
}
export class PlacementRecommendationDto {
  @ApiProperty({ type: String }) locationId!: string;
  @ApiProperty({ type: String, nullable: true }) sourceLocationId!:
    | string
    | null;
  @ApiProperty({
    type: String,
    enum: ["aisles", "floor", "unknown", "unreachable"],
  })
  routeStatus!: "aisles" | "floor" | "unknown" | "unreachable";
  @ApiProperty({
    type: Number,
    nullable: true,
    description: "Оценка длины пути по схеме, без условной стоимости яруса",
  })
  distanceMeters!: number | null;
  @ApiProperty({
    type: Number,
    description: "0 — напольное место, 1 и выше — ярус",
  })
  level!: number;
  @ApiProperty({
    type: Number,
    description:
      "Мягкий вес дополнительного подъёма в эквивалентных метрах, не длина пути",
  })
  levelPenaltyMeters!: number;
  @ApiProperty({ type: Boolean }) sameSkuPallet!: boolean;
  @ApiProperty({ type: String }) explanation!: string;
}
export class ReceiptPlacementOptionsDto {
  @ApiProperty({ type: PlacementRecommendationDto, nullable: true })
  recommendation!: PlacementRecommendationDto | null;
  @ApiProperty({ type: String }) palletId!: string;
  @ApiProperty({ type: String, nullable: true }) suggestedLocationId!:
    | string
    | null;
  @ApiProperty({ type: [LocationDto] }) locations!: LocationDto[];
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
}
export class ReceiptLabelDto {
  @ApiProperty({ type: String }) palletId!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: Number }) quantity!: number;
  @ApiProperty({ type: String }) payload!: string;
  @ApiProperty({ type: String }) svg!: string;
}
export class ReceiptLabelsDto {
  @ApiProperty({ type: String }) receiptCode!: string;
  @ApiProperty({ type: String }) receivedAt!: string;
  @ApiProperty({ type: [ReceiptLabelDto] }) labels!: ReceiptLabelDto[];
}
export class PutawayTaskDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) boxId!: string;
  @ApiProperty({ type: String }) skuId!: string;
  @ApiProperty({
    type: String,
    enum: ["queued", "claimed", "in_transit", "completed"],
  })
  status!: string;
  @ApiProperty({ type: String, nullable: true }) employeeId!: string | null;
  @ApiProperty({ type: String }) fromPalletId!: string;
  @ApiProperty({ type: String }) fromLocationId!: string;
  @ApiProperty({ type: String, nullable: true }) toLocationId!: string | null;
  @ApiProperty({ type: String }) createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) claimedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) takenAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) completedAt!: string | null;
}
export class PutawayPlacementOptionsDto {
  @ApiProperty({ type: PlacementRecommendationDto, nullable: true })
  recommendation!: PlacementRecommendationDto | null;
  @ApiProperty({ type: String }) boxId!: string;
  @ApiProperty({ type: [LocationDto] }) locations!: LocationDto[];
  @ApiProperty({ type: String, nullable: true }) suggestedLocationId!:
    | string
    | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
}
export class AddressHoldDto {
  @ApiProperty({ type: String }) locationId!: string;
  @ApiProperty({ type: String, enum: ["movement", "putaway", "return"] })
  kind!: "movement" | "putaway" | "return";
}
export class AssemblyPressureDto {
  @ApiProperty({
    type: String,
    enum: ["normal", "near_full", "full", "unavailable"],
  })
  level!: "normal" | "near_full" | "full" | "unavailable";
  @ApiProperty({ type: String, nullable: true }) locationId!: string | null;
  @ApiProperty({ type: String, nullable: true }) palletId!: string | null;
  @ApiProperty({ type: Number }) boxes!: number;
  @ApiProperty({ type: Number }) committedBoxes!: number;
  @ApiProperty({ type: Number, nullable: true }) capacityBoxes!: number | null;
  @ApiProperty({ type: String }) message!: string;
}
export class ZoneOfferDto {
  @ApiProperty({ type: String }) zoneId!: string;
  @ApiProperty({ type: String }) jobId!: string;
  @ApiProperty({ type: String, nullable: true }) palletId!: string | null;
  @ApiProperty({ type: Boolean }) resume!: boolean;
  @ApiProperty({ type: Boolean }) inProgress!: boolean;
}
export class WorkspaceDto {
  @ApiPropertyOptional({ type: [ZoneOfferDto] }) zoneOffers?: ZoneOfferDto[];
  @ApiPropertyOptional({ type: AssemblyPressureDto })
  assemblyPressure?: AssemblyPressureDto;
  @ApiPropertyOptional({ type: [AddressHoldDto] })
  addressHolds?: AddressHoldDto[];
  @ApiProperty({ type: [PutawayTaskDto] }) putawayTasks!: PutawayTaskDto[];
  @ApiProperty({ type: [ReceiptDto] }) receipts!: ReceiptDto[];
  @ApiProperty({ type: BalanceDto }) balance!: BalanceDto;
  @ApiProperty({
    type: Number,
    minimum: 0,
    format: "int64",
    description: "Монотонная ревизия состояния склада",
  })
  revision!: number;
  @ApiProperty({ type: WarehousePlanDto }) warehouse!: WarehousePlanDto;
  @ApiProperty({ type: [AisleDto] }) aisles!: AisleDto[];
  @ApiProperty({ type: [EntranceDto] }) entrances!: EntranceDto[];
  @ApiProperty({ type: [RackSectionDto] }) sections!: RackSectionDto[];
  @ApiProperty({ type: [MovementDto] }) movements!: MovementDto[];
  @ApiProperty({ type: [SkuDto] }) skus!: SkuDto[];
  @ApiProperty({ type: [LocationDto] }) locations!: LocationDto[];
  @ApiProperty({ type: [LotDto] }) lots!: LotDto[];
  @ApiProperty({ type: [PalletDto] }) pallets!: PalletDto[];
  @ApiProperty({ type: [BoxDto] }) boxes!: BoxDto[];
  @ApiProperty({ type: [TaskDto] }) tasks!: TaskDto[];
  @ApiProperty({ type: [EmployeeDto] }) employees!: EmployeeDto[];
  @ApiProperty({ type: [ShipmentDto] }) shipments!: ShipmentDto[];
  @ApiProperty({ type: [ActivityDto] }) activities!: ActivityDto[];
}
export class CommandDto {
  @ApiProperty({ example: "unique-request-id", type: String })
  @IsString()
  @MaxLength(150)
  requestId!: string;
}
export class UpdateSkuBarcodesDto extends CommandDto {
  @ApiProperty({ type: [String], maxItems: 50 })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(150, { each: true })
  alternateBarcodes!: string[];
}

export class ChangeConsumablesDto extends CommandDto {
  @ApiProperty({ type: String, enum: consumableItems })
  @IsIn(consumableItems)
  item!: ConsumableItem;

  @ApiProperty({ type: String, enum: ["count", "receive"] })
  @IsIn(["count", "receive"])
  mode!: "count" | "receive";

  @ApiProperty({ type: Number })
  @IsInt()
  @Min(0)
  @Max(1000000000)
  quantity!: number;

  @ApiProperty({ type: Number })
  @IsInt()
  @Min(0)
  @Max(1000000000)
  expectedQuantity!: number;
}

export class PhysicalAddressDto extends CommandDto {
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(100)
  @Max(10000)
  availableWidthMm!: number;
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(100)
  @Max(10000)
  availableDepthMm!: number;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsNumber()
  @Min(0.001)
  @Max(100000)
  maxWeightKg?: number | null;
  @ApiPropertyOptional({ type: Number, default: 1 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(4)
  accessSides?: number;
}
export class CreateLocationDto extends PhysicalAddressDto {
  @ApiPropertyOptional({ type: Number, enum: [0, 90, 180, 270] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn([0, 90, 180, 270])
  rotation?: number;
  @ApiProperty({ example: "B-01-01", type: String })
  @IsString()
  @MaxLength(40)
  code!: string;
  @ApiProperty({ example: "Секция B · Ярус 1", type: String })
  @IsString()
  @MaxLength(100)
  name!: string;
  @ApiProperty({
    enum: ["floor", "receiving", "assembly", "shipping", "picking"],
    type: String,
  })
  @IsIn(["floor", "receiving", "assembly", "shipping", "picking"])
  kind!: string;
  @ApiProperty({ default: 0, type: Number })
  @IsNumber()
  @Min(0)
  @Max(1000)
  x!: number;
  @ApiProperty({ default: 0, type: Number })
  @IsNumber()
  @Min(0)
  @Max(1000)
  y!: number;
  @ApiProperty({ default: 1.3, type: Number, minimum: 0.1 })
  @IsNumber()
  @Min(0.1)
  @Max(1000)
  width!: number;
  @ApiProperty({ default: 0.9, type: Number, minimum: 0.1 })
  @IsNumber()
  @Min(0.1)
  @Max(1000)
  depth!: number;
  @ApiProperty({ default: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(10)
  levels!: number;
  @ApiProperty({ default: 1800, type: Number })
  @IsInt()
  @Min(100)
  @Max(10000)
  maxHeightMm!: number;
  @ApiProperty({ default: 18, type: Number })
  @IsInt()
  @Min(1)
  @Max(1000)
  maxBoxes!: number;
  @ApiPropertyOptional({ default: false, type: Boolean })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  blocked?: boolean;
}
export class UpdateLocationDto extends CommandDto {
  @ApiPropertyOptional({ type: Number, enum: [0, 90, 180, 270] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn([0, 90, 180, 270])
  rotation?: number;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(100)
  @Max(10000)
  availableWidthMm?: number;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(100)
  @Max(10000)
  availableDepthMm?: number;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsNumber()
  @Min(0.001)
  @Max(100000)
  maxWeightKg?: number | null;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(4)
  accessSides?: number;

  @ApiPropertyOptional({ type: String })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(40)
  code?: string;
  @ApiPropertyOptional({
    type: String,
    enum: ["rack", "floor", "receiving", "assembly", "shipping", "picking"],
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["rack", "floor", "receiving", "assembly", "shipping", "picking"])
  kind?: string;
  @ApiPropertyOptional({ type: Number, minimum: 0.1 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber()
  @Min(0.1)
  @Max(1000)
  width?: number;
  @ApiPropertyOptional({ type: Number, minimum: 0.1 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber()
  @Min(0.1)
  @Max(1000)
  depth?: number;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(10)
  levels?: number;

  @ApiPropertyOptional({ type: String })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  name?: string;
  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  blocked?: boolean;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(100)
  @Max(10000)
  maxHeightMm?: number;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxBoxes?: number;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber()
  @Min(0)
  @Max(1000)
  x?: number;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber()
  @Min(0)
  @Max(1000)
  y?: number;
}
const trimText = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
export class ReceiptNewSkuDto {
  @ApiProperty({ type: String, maxLength: 100 })
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
  @ApiProperty({ type: String, maxLength: 150 })
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  barcode!: string;
  @ApiPropertyOptional({ type: String, maxLength: 40 })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code?: string;
  @ApiPropertyOptional({ type: Number, default: 20 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(1000)
  unitsPerBox?: number;
}
export class CreateSkuDto extends CommandDto {
  @ApiProperty({ type: String, maxLength: 100 })
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
  @ApiProperty({ type: String, maxLength: 150 })
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  barcode!: string;
  @ApiPropertyOptional({ type: String, maxLength: 40 })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code?: string;
  @ApiPropertyOptional({ type: Number, default: 20 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(1000)
  unitsPerBox?: number;
}
@ValidatorConstraint({ name: "receiptSkuChoice", async: false })
class ReceiptSkuChoice implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments) {
    const o = args.object as CreateReceiptPalletDto;
    return (o.skuId !== undefined) !== (o.newSku !== undefined);
  }
  defaultMessage() {
    return "Укажите ровно одно: skuId или newSku";
  }
}
export class CreateReceiptPalletDto {
  @ApiPropertyOptional({ type: String })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  skuId?: string;
  @ApiPropertyOptional({ type: ReceiptNewSkuDto })
  @ValidateIf((_o, v) => v !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => ReceiptNewSkuDto)
  newSku?: ReceiptNewSkuDto;
  @ApiProperty({ type: Number, default: 1000 })
  @Validate(ReceiptSkuChoice)
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity!: number;
  @ApiPropertyOptional({ type: Number, default: 1200 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(100)
  @Max(10000)
  widthMm?: number;
  @ApiPropertyOptional({ type: Number, default: 800 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(100)
  @Max(10000)
  depthMm?: number;
  @ApiPropertyOptional({ type: Number, default: 1400 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(100)
  @Max(10000)
  heightMm?: number;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsNumber()
  @Min(0.001)
  @Max(100000)
  weightKg?: number | null;
}
export class CreateReceiptDto extends CommandDto {
  @ApiProperty({ type: String, format: "date-time" })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  receivedAt!: string;
  @ApiProperty({ type: [CreateReceiptPalletDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateReceiptPalletDto)
  pallets!: CreateReceiptPalletDto[];
}
export class PlaceReceiptPalletDto extends CommandDto {
  @ApiProperty({ type: String }) @IsString() @MinLength(1) employeeId!: string;
  @ApiProperty({ type: String }) @IsString() @MinLength(1) palletCode!: string;
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  locationCode!: string;
}
export class CreateEmployeeDto extends CommandDto {
  @ApiProperty({ type: String, maxLength: 100 })
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
  @ApiPropertyOptional({ type: String, maxLength: 100 })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  role?: string;
}
export class CreateTaskDto extends CommandDto {
  @ApiProperty({ type: String }) @IsString() skuId!: string;
  @ApiProperty({
    default: 1,
    type: Number,
    description: "Количество отдельных заданий по одному коробу",
  })
  @IsInt()
  @Min(1)
  @Max(5)
  boxesTarget!: number;
  @ApiPropertyOptional({ type: String })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  employeeId?: string;
}
export class ClaimTaskDto extends CommandDto {
  @ApiProperty({ type: String }) @IsString() @MinLength(1) employeeId!: string;
}
export class ClaimPutawayTaskDto extends ClaimTaskDto {}
export class TakePutawayBoxDto extends ClaimTaskDto {
  @ApiProperty({
    type: String,
    description: "QR короба, который сотрудник забирает",
  })
  @IsString()
  @MinLength(1)
  boxCode!: string;
}
export class PlacePutawayBoxDto extends ClaimTaskDto {
  @ApiProperty({
    type: String,
    description: "QR зарезервированного адреса для короба у сотрудника",
  })
  @IsString()
  @MinLength(1)
  locationCode!: string;
}
export class ConfirmPutawayTaskDto extends ClaimTaskDto {
  @ApiProperty({ type: String }) @IsString() @MinLength(1) boxCode!: string;
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  locationCode!: string;
}
export class AssignTaskDto extends CommandDto {
  @ApiProperty({ type: String, nullable: true })
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MinLength(1)
  employeeId!: string | null;
}
export class ScanTaskDto extends ClaimTaskDto {
  @ApiProperty({ enum: ["source", "box", "barcode"], type: String })
  @IsIn(["source", "box", "barcode"])
  kind!: "source" | "box" | "barcode";
  @ApiProperty({
    description: "Код/QR паллеты, текущего короба или штрихкод тематики",
    type: String,
  })
  @IsString()
  value!: string;
}
export class PackTaskDto extends ClaimTaskDto {
  @ApiProperty({
    description: "Scan the current unique box code",
    type: String,
  })
  @IsString()
  boxCode!: string;
}
export class UpdateTaskStatusDto extends ClaimTaskDto {
  @ApiProperty({ enum: ["active", "paused"], type: String })
  @IsIn(["active", "paused"])
  status!: "active" | "paused";
}
export class CreateShipmentDto extends CommandDto {
  @ApiProperty({ type: String }) @IsString() skuId!: string;
  @ApiProperty({ default: 5, type: Number })
  @IsInt()
  @Min(1)
  @Max(10000)
  boxesRequested!: number;
}
export class UpdateShiftDto extends CommandDto {
  @ApiProperty({ enum: ["working", "break", "off"], type: String })
  @IsIn(["working", "break", "off"])
  status!: string;
}
export class LabelDto {
  @ApiPropertyOptional({
    type: String,
    description: "Resolved box ID when requested by its internal ID",
  })
  boxId?: string;
  @ApiProperty({ type: String }) payload!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) svg!: string;
}

export class RackLevelInputDto {
  @ApiProperty({ type: String }) @IsString() @MaxLength(40) code!: string;
  @ApiProperty({ type: String }) @IsString() @MaxLength(100) name!: string;
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(100)
  @Max(10000)
  maxHeightMm!: number;
  @ApiProperty({ type: Number }) @IsInt() @Min(1) @Max(1000) maxBoxes!: number;
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(100)
  @Max(10000)
  availableWidthMm!: number;
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(100)
  @Max(10000)
  availableDepthMm!: number;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsNumber()
  @Min(0.001)
  @Max(100000)
  maxWeightKg?: number | null;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(4)
  accessSides?: number;
}
export class CreateRackSectionDto extends CommandDto {
  @ApiPropertyOptional({ type: Number, enum: [0, 90, 180, 270] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn([0, 90, 180, 270])
  rotation?: number;
  @ApiProperty({ type: String }) @IsString() @MaxLength(40) code!: string;
  @ApiProperty({ type: String }) @IsString() @MaxLength(100) name!: string;
  @ApiProperty({ type: Number }) @IsNumber() @Min(0) @Max(1000) x!: number;
  @ApiProperty({ type: Number }) @IsNumber() @Min(0) @Max(1000) y!: number;
  @ApiProperty({ type: Number, minimum: 0.1 })
  @IsNumber()
  @Min(0.1)
  @Max(1000)
  width!: number;
  @ApiProperty({ type: Number, minimum: 0.1 })
  @IsNumber()
  @Min(0.1)
  @Max(1000)
  depth!: number;
  @ApiProperty({ type: [RackLevelInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RackLevelInputDto)
  levels!: RackLevelInputDto[];
}
export class CopyRackSectionDto extends CommandDto {
  @ApiProperty({
    type: Number,
    minimum: 0,
    maximum: 1000,
    description: "Новая глобальная координата X секции в метрах",
  })
  @IsNumber()
  @Min(0)
  @Max(1000)
  x!: number;
  @ApiProperty({
    type: Number,
    minimum: 0,
    maximum: 1000,
    description: "Новая глобальная координата Y секции в метрах",
  })
  @IsNumber()
  @Min(0)
  @Max(1000)
  y!: number;
}
export class UpdateRackSectionDto extends CommandDto {
  @ApiPropertyOptional({ type: Number, enum: [0, 90, 180, 270] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn([0, 90, 180, 270])
  rotation?: number;
  @ApiPropertyOptional({ type: String })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(40)
  code?: string;
  @ApiPropertyOptional({ type: String })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(100)
  name?: string;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0)
  @Max(1000)
  x?: number;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0)
  @Max(1000)
  y?: number;
  @ApiPropertyOptional({ type: Number, minimum: 0.1 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0.1)
  @Max(1000)
  width?: number;
  @ApiPropertyOptional({ type: Number, minimum: 0.1 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0.1)
  @Max(1000)
  depth?: number;
}
export class CreateRackLevelDto extends RackLevelInputDto {
  @ApiProperty({ type: String }) @IsString() @MaxLength(150) requestId!: string;
}
export class UpdateSkuPackagingDto extends CommandDto {
  @ApiProperty({ type: PackagingProfileDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PackagingProfileDto)
  packaging!: PackagingProfileDto;
}
export class CreateMovementDto extends CommandDto {
  @ApiProperty({ type: String }) @IsString() palletId!: string;
  @ApiProperty({ type: String }) @IsString() toLocationId!: string;
  @ApiProperty({ type: String, enum: ["transfer", "lower", "return"] })
  @IsIn(["transfer", "lower", "return"])
  kind!: string;
  @ApiProperty({ type: String }) @IsString() employeeId!: string;
  @ApiPropertyOptional({
    type: Boolean,
    description: "Для lower по умолчанию true; для остальных false",
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  keepSourceReserved?: boolean;
}
export class ClaimMovementDto extends CommandDto {
  @ApiProperty({ type: String }) @IsString() employeeId!: string;
}
export class ConfirmMovementDto extends CommandDto {
  @ApiProperty({ type: String }) @IsString() palletCode!: string;
  @ApiProperty({ type: String }) @IsString() locationCode!: string;
}
export class RetireEmptyPalletDto extends ConfirmMovementDto {}

export class UpdateWarehousePlanDto extends CommandDto {
  @ApiPropertyOptional({ type: String, enum: ["rectangle", "spaces"] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(["rectangle", "spaces"])
  layoutMode?: string;

  @ApiPropertyOptional({ type: String })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(100)
  name?: string;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(1)
  @Max(1000)
  width?: number;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(1)
  @Max(1000)
  depth?: number;
}
export class CreateAisleDto extends CommandDto {
  @ApiProperty({ type: String }) @IsString() @MaxLength(100) name!: string;
  @ApiProperty({ type: Number }) @IsNumber() @Min(0) @Max(1000) x!: number;
  @ApiProperty({ type: Number }) @IsNumber() @Min(0) @Max(1000) y!: number;
  @ApiProperty({ type: Number })
  @IsNumber()
  @Min(0.5)
  @Max(1000)
  width!: number;
  @ApiProperty({ type: Number })
  @IsNumber()
  @Min(0.5)
  @Max(1000)
  depth!: number;
  @ApiPropertyOptional({ type: Number, enum: [0, 90, 180, 270] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn([0, 90, 180, 270])
  rotation?: number;
}
export class UpdateAisleDto extends CommandDto {
  @ApiPropertyOptional({ type: String })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(100)
  name?: string;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0)
  @Max(1000)
  x?: number;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0)
  @Max(1000)
  y?: number;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0.5)
  @Max(1000)
  width?: number;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0.5)
  @Max(1000)
  depth?: number;
  @ApiPropertyOptional({ type: Number, enum: [0, 90, 180, 270] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn([0, 90, 180, 270])
  rotation?: number;
}
export class CreateEntranceDto extends CommandDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  spaceId?: string | null;

  @ApiProperty({ type: String }) @IsString() @MaxLength(100) name!: string;
  @ApiProperty({ type: String, enum: ["north", "east", "south", "west"] })
  @IsIn(["north", "east", "south", "west"])
  wall!: string;
  @ApiProperty({ type: Number }) @IsNumber() @Min(0) @Max(1000) offset!: number;
  @ApiProperty({ type: Number })
  @IsNumber()
  @Min(0.5)
  @Max(1000)
  width!: number;
}
export class UpdateEntranceDto extends CommandDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  spaceId?: string | null;

  @ApiPropertyOptional({ type: String })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(100)
  name?: string;
  @ApiPropertyOptional({
    type: String,
    enum: ["north", "east", "south", "west"],
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(["north", "east", "south", "west"])
  wall?: string;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0)
  @Max(1000)
  offset?: number;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0.5)
  @Max(1000)
  width?: number;
}

export class CreateSpaceDto extends CommandDto {
  @ApiProperty({ type: String }) @IsString() @MaxLength(100) name!: string;
  @ApiProperty({ type: String, enum: ["room", "corridor"] })
  @IsIn(["room", "corridor"])
  kind!: string;
  @ApiProperty({ type: Number }) @IsNumber() @Min(0) @Max(1000) x!: number;
  @ApiProperty({ type: Number }) @IsNumber() @Min(0) @Max(1000) y!: number;
  @ApiProperty({ type: Number })
  @IsNumber()
  @Min(0.5)
  @Max(1000)
  width!: number;
  @ApiProperty({ type: Number })
  @IsNumber()
  @Min(0.5)
  @Max(1000)
  depth!: number;
}
export class ResizeSpaceDto extends CommandDto {
  @ApiProperty({
    type: Number,
    description:
      "Новая левая граница в метрах; содержимое сохраняет координаты",
  })
  @IsNumber()
  @Min(0)
  @Max(1000)
  x!: number;
  @ApiProperty({
    type: Number,
    description:
      "Новая верхняя граница в метрах; содержимое сохраняет координаты",
  })
  @IsNumber()
  @Min(0)
  @Max(1000)
  y!: number;
  @ApiProperty({ type: Number, minimum: 0.5, maximum: 1000 })
  @IsNumber()
  @Min(0.5)
  @Max(1000)
  width!: number;
  @ApiProperty({ type: Number, minimum: 0.5, maximum: 1000 })
  @IsNumber()
  @Min(0.5)
  @Max(1000)
  depth!: number;
}
export class UpdateSpaceDto extends CommandDto {
  @ApiPropertyOptional({ type: String })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(100)
  name?: string;
  @ApiPropertyOptional({ type: String, enum: ["room", "corridor"] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(["room", "corridor"])
  kind?: string;
  @ApiPropertyOptional({
    type: Number,
    description:
      "Глобальная координата X в метрах. Изменение переносит участок и его содержимое относительно исходного положения.",
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0)
  @Max(1000)
  x?: number;
  @ApiPropertyOptional({
    type: Number,
    description:
      "Глобальная координата Y в метрах. Изменение переносит участок и его содержимое относительно исходного положения.",
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0)
  @Max(1000)
  y?: number;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0.5)
  @Max(1000)
  width?: number;
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber()
  @Min(0.5)
  @Max(1000)
  depth?: number;
}

export const STOCK_LEDGER_KINDS = [
  "opening_balance",
  "receipt_placement",
  "assembly",
  "putaway",
  "movement",
  "shipment_pick",
  "shipment",
  "adjustment",
] as const;
export class StockLedgerLineDto {
  @ApiProperty({ type: String }) skuId!: string;
  @ApiProperty({ type: String }) skuCode!: string;
  @ApiProperty({ type: String }) skuName!: string;
  @ApiProperty({ type: String }) lotId!: string;
  @ApiProperty({ type: String }) lotName!: string;
  @ApiProperty({ type: String }) receivedAt!: string;
  @ApiProperty({ enum: ["raw", "wip", "boxed"], type: String }) stage!: string;
  @ApiProperty({ enum: ["pallet", "task", "box"], type: String })
  containerType!: string;
  @ApiProperty({ type: String }) containerId!: string;
  @ApiProperty({ type: String }) containerCode!: string;
  @ApiProperty({ type: String, nullable: true }) palletId!: string | null;
  @ApiProperty({ type: String, nullable: true }) palletCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) locationId!: string | null;
  @ApiProperty({ type: String, nullable: true }) locationCode!: string | null;
  @ApiProperty({ type: Number }) quantityDelta!: number;
}
export class StockLedgerEventDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: Number }) revision!: number;
  @ApiProperty({ type: String, nullable: true }) requestId!: string | null;
  @ApiProperty({ enum: STOCK_LEDGER_KINDS, type: String }) kind!: string;
  @ApiProperty({ type: String }) createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) employeeId!: string | null;
  @ApiProperty({ type: String, nullable: true }) employeeName!: string | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: String, nullable: true }) referenceType!: string | null;
  @ApiProperty({ type: String, nullable: true }) referenceId!: string | null;
  @ApiProperty({ type: String, nullable: true }) referenceCode!: string | null;
  @ApiProperty({ type: Number }) unitsDelta!: number;
  @ApiProperty({ type: [StockLedgerLineDto] }) lines!: StockLedgerLineDto[];
}
export class StockLedgerSummaryDto {
  @ApiProperty({ type: String }) startedAt!: string;
  @ApiProperty({ type: Number }) eventsCount!: number;
  @ApiProperty({ type: Number }) ledgerUnits!: number;
  @ApiProperty({ type: Number }) onHandUnits!: number;
  @ApiProperty({ type: Boolean }) reconciled!: boolean;
}
export class StockLedgerPageDto {
  @ApiProperty({ type: [StockLedgerEventDto] }) items!: StockLedgerEventDto[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: StockLedgerSummaryDto }) summary!: StockLedgerSummaryDto;
}
export class StockLedgerQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page?: number;
  @ApiPropertyOptional({ type: Number, default: 25, minimum: 1, maximum: 100 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
  @ApiPropertyOptional({ enum: STOCK_LEDGER_KINDS, type: String })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(STOCK_LEDGER_KINDS)
  kind?: string;
  @ApiPropertyOptional({ type: String })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  skuId?: string;
  @ApiPropertyOptional({ type: String })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  employeeId?: string;
  @ApiPropertyOptional({ type: String, format: "date-time" })
  @ValidateIf((_o, v) => v !== undefined)
  @IsISO8601({ strict: true })
  from?: string;
  @ApiPropertyOptional({ type: String, format: "date-time" })
  @ValidateIf((_o, v) => v !== undefined)
  @IsISO8601({ strict: true })
  to?: string;
  @ApiPropertyOptional({ type: String })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  search?: string;
}
export class AdjustStockDto extends CommandDto {
  @ApiProperty({ enum: ["raw_count", "box_writeoff"], type: String })
  @IsIn(["raw_count", "box_writeoff"])
  kind!: string;
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  targetId!: string;
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  employeeId!: string;
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  expectedLocationId!: string;
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(0)
  @Max(100000000)
  expectedQuantity!: number;
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(0)
  @Max(100000000)
  countedQuantity!: number;
  @ApiProperty({ type: String, minLength: 5, maxLength: 500 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class AuthUserDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) employeeId!: string;
  @ApiProperty({ type: String }) login!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, enum: ["manager", "employee"] }) role!:
    | "manager"
    | "employee";
  @ApiProperty({ type: Boolean }) mustChangePassword!: boolean;
}
export class AuthSessionDto {
  @ApiProperty({ type: Boolean }) needsSetup!: boolean;
  @ApiProperty({ type: AuthUserDto, nullable: true }) user!: AuthUserDto | null;
  @ApiProperty({ type: String, nullable: true }) csrfToken!: string | null;
  @ApiProperty({ type: String, nullable: true }) expiresAt!: string | null;
}
export class SetupAuthDto {
  @ApiProperty({ type: String, minLength: 2, maxLength: 100 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;
  @ApiProperty({ type: String, minLength: 3, maxLength: 64 })
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9._-]{2,63}$/)
  login!: string;
  @ApiProperty({ type: String, minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
export class LoginDto {
  @ApiProperty({ type: String })
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  login!: string;
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
export class ChangePasswordDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;
  @ApiProperty({ type: String, minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}
export class AuthAccountDto extends AuthUserDto {
  @ApiProperty({ type: Boolean }) blocked!: boolean;
  @ApiProperty({ type: String }) createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) lastLoginAt!: string | null;
  @ApiProperty({ type: Number }) activeSessions!: number;
}
export class AuthAccountsDto {
  @ApiProperty({ type: [AuthAccountDto] }) items!: AuthAccountDto[];
}
export class CreateAuthAccountDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  employeeId!: string;
  @ApiProperty({ type: String, minLength: 3, maxLength: 64 })
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9._-]{2,63}$/)
  login!: string;
  @ApiProperty({ type: String, enum: ["manager", "employee"] })
  @IsIn(["manager", "employee"])
  role!: "manager" | "employee";
  @ApiProperty({ type: String, minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
export class UpdateAuthAccountDto {
  @ApiPropertyOptional({ type: String, enum: ["manager", "employee"] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(["manager", "employee"])
  role?: "manager" | "employee";
  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  blocked?: boolean;
}
export class ResetAuthPasswordDto {
  @ApiProperty({ type: String, minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class PerformanceQueryDto {
  @ApiPropertyOptional({
    type: String,
    format: "date",
    description: "Первый календарный день Europe/Moscow включительно",
  })
  @ValidateIf((_o, v) => v !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  from?: string;
  @ApiPropertyOptional({
    type: String,
    format: "date",
    description:
      "Последний календарный день Europe/Moscow включительно; диапазон не больше366 дней",
  })
  @ValidateIf((_o, v) => v !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  to?: string;
  @ApiPropertyOptional({ type: String })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  employeeId?: string;
}
export class WorkforceHistoryQueryDto extends PerformanceQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page?: number;
  @ApiPropertyOptional({ type: Number, default: 25, minimum: 1, maximum: 100 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
export class PerformanceMetricsDto {
  @ApiProperty({ type: Number }) boxesPacked!: number;
  @ApiProperty({ type: Number }) unitsPacked!: number;
  @ApiProperty({ type: Number }) receiptPalletsPlaced!: number;
  @ApiProperty({ type: Number }) putawayBoxesPlaced!: number;
  @ApiProperty({ type: Number }) movementPalletsPlaced!: number;
  @ApiProperty({
    type: Number,
    description: "В смене без перерывов; не измерение активности",
  })
  workingSeconds!: number;
  @ApiProperty({ type: Number }) breakSeconds!: number;
}
export class CurrentShiftDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) startedAt!: string;
  @ApiProperty({ type: String, enum: ["explicit", "observed_from_migration"] })
  origin!: string;
  @ApiProperty({ type: String, enum: ["working", "break"] }) status!: string;
  @ApiProperty({ type: String }) periodStartedAt!: string;
  @ApiProperty({ type: Number }) workingSeconds!: number;
  @ApiProperty({ type: Number }) breakSeconds!: number;
}
export class WorkJobDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({
    type: String,
    enum: ["assembly", "putaway", "movement", "stocktake"],
  })
  kind!: string;
  @ApiProperty({ type: String }) status!: string;
  @ApiProperty({ type: String }) description!: string;
}
export class EmployeePerformanceDto {
  @ApiProperty({ type: String }) employeeId!: string;
  @ApiProperty({ type: String }) employeeName!: string;
  @ApiProperty({ type: String, enum: ["off", "working", "break"] })
  status!: string;
  @ApiProperty({ type: CurrentShiftDto, nullable: true })
  currentShift!: CurrentShiftDto | null;
  @ApiProperty({ type: [WorkJobDto] }) currentJobs!: WorkJobDto[];
  @ApiProperty({ type: PerformanceMetricsDto }) metrics!: PerformanceMetricsDto;
}
export class PerformanceReportDto {
  @ApiProperty({ type: String }) trackingSince!: string;
  @ApiProperty({ type: String, format: "date" }) from!: string;
  @ApiProperty({ type: String, format: "date" }) to!: string;
  @ApiProperty({ type: String, enum: ["Europe/Moscow"] }) timezone!: string;
  @ApiProperty({ type: String }) generatedAt!: string;
  @ApiProperty({ type: [EmployeePerformanceDto] })
  employees!: EmployeePerformanceDto[];
}
export class ShiftIntervalDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String, enum: ["working", "break"] }) status!: string;
  @ApiProperty({ type: String }) startedAt!: string;
  @ApiProperty({ type: String, nullable: true }) endedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) actorEmployeeId!:
    | string
    | null;
  @ApiProperty({ type: String, nullable: true }) actorName!: string | null;
  @ApiProperty({
    type: Number,
    description: "Пересечение интервала с выбранным отчётным периодом",
  })
  durationSeconds!: number;
}
export class ShiftHistoryDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) employeeId!: string;
  @ApiProperty({ type: String }) employeeName!: string;
  @ApiProperty({ type: String }) startedAt!: string;
  @ApiProperty({ type: String, nullable: true }) endedAt!: string | null;
  @ApiProperty({ type: String, enum: ["explicit", "observed_from_migration"] })
  origin!: string;
  @ApiProperty({ type: String, nullable: true }) startedByEmployeeId!:
    | string
    | null;
  @ApiProperty({ type: String, nullable: true }) startedByName!: string | null;
  @ApiProperty({ type: String, nullable: true }) endedByEmployeeId!:
    | string
    | null;
  @ApiProperty({ type: String, nullable: true }) endedByName!: string | null;
  @ApiProperty({ type: Number }) workingSeconds!: number;
  @ApiProperty({ type: Number }) breakSeconds!: number;
  @ApiProperty({ type: [ShiftIntervalDto] }) intervals!: ShiftIntervalDto[];
}
export class ShiftHistoryPageDto {
  @ApiProperty({ type: String }) trackingSince!: string;
  @ApiProperty({ type: [ShiftHistoryDto] }) items!: ShiftHistoryDto[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
}
export class WorkEventDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) employeeId!: string;
  @ApiProperty({ type: String }) employeeName!: string;
  @ApiProperty({
    type: String,
    enum: [
      "box_packed",
      "receipt_pallet_placed",
      "putaway_box_placed",
      "movement_pallet_placed",
    ],
  })
  kind!: string;
  @ApiProperty({ type: String }) occurredAt!: string;
  @ApiProperty({ type: String, nullable: true }) requestId!: string | null;
  @ApiProperty({ type: String, nullable: true }) shiftId!: string | null;
  @ApiProperty({ type: String }) referenceId!: string;
  @ApiProperty({ type: String }) referenceCode!: string;
  @ApiProperty({ type: Number }) quantity!: number;
  @ApiProperty({
    type: Number,
    description:
      "Упакованные единицы только для box_packed; для остальных операций0",
  })
  units!: number;
}
export class WorkHistoryPageDto {
  @ApiProperty({ type: String }) trackingSince!: string;
  @ApiProperty({ type: [WorkEventDto] }) items!: WorkEventDto[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
}

export const STOCKTAKE_STATUSES = [
  "queued",
  "counting",
  "review",
  "approved",
  "cancelled",
] as const;
export class StocktakeRawPalletDto {
  @ApiProperty({ type: String }) palletId!: string;
  @ApiProperty({ type: String }) palletCode!: string;
  @ApiProperty({ type: String }) skuId!: string;
  @ApiProperty({ type: String }) skuName!: string;
  @ApiProperty({ type: String }) lotId!: string;
  @ApiProperty({ type: String }) lotName!: string;
  @ApiProperty({ type: String }) receivedAt!: string;
  @ApiProperty({ type: Number }) quantity!: number;
}
export class StocktakeBoxDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) skuId!: string;
  @ApiProperty({ type: String }) skuName!: string;
  @ApiProperty({ type: Number }) units!: number;
  @ApiProperty({ type: String }) palletId!: string;
}
export class StocktakeInventoryDto {
  @ApiProperty({ type: PalletDto, nullable: true }) pallet!: PalletDto | null;
  @ApiProperty({ type: [StocktakeRawPalletDto] })
  rawPallets!: StocktakeRawPalletDto[];
  @ApiProperty({ type: [StocktakeBoxDto] }) boxes!: StocktakeBoxDto[];
}
export class StocktakeRawCountDto {
  @ApiProperty({ type: String })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  palletCode!: string;
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(0)
  @Max(100000000)
  quantity!: number;
}
export class OpeningStocktakeBatchDto {
  @ApiProperty({
    type: String,
    description: "Фактическая дата поступления на склад",
  })
  @IsISO8601({ strict: true })
  @MaxLength(40)
  receivedAt!: string;
  @ApiProperty({ type: Number, minimum: 1, maximum: 100000000 })
  @IsInt()
  @Min(1)
  @Max(100000000)
  quantity!: number;
}
export class OpeningPalletCountDto {
  @ApiProperty({ type: String, enum: ["raw", "finished"] })
  @IsIn(["raw", "finished"])
  kind!: "raw" | "finished";
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  skuId!: string;
  @ApiProperty({
    type: [OpeningStocktakeBatchDto],
    minItems: 1,
    maxItems: 2000,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => OpeningStocktakeBatchDto)
  batches!: OpeningStocktakeBatchDto[];
  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(1000)
  unitsPerBox?: number;
  @ApiPropertyOptional({
    type: Number,
    description: "Полная высота сырьевой паллеты с поддоном",
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(150)
  @Max(10000)
  heightMm?: number;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsNumber()
  @Min(0.001)
  @Max(100000)
  weightKg?: number | null;
}
export class OpeningStocktakeResultDto {
  @ApiProperty({ type: String, nullable: true }) palletId!: string | null;
  @ApiProperty({ type: [String] }) boxIds!: string[];
}
export class StocktakeCountDto {
  @ApiPropertyOptional({ type: OpeningPalletCountDto, nullable: true })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @ValidateNested()
  @Type(() => OpeningPalletCountDto)
  openingPallet?: OpeningPalletCountDto | null;
  @ApiProperty({ type: [StocktakeRawCountDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StocktakeRawCountDto)
  rawPallets!: StocktakeRawCountDto[];
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(150, { each: true })
  boxCodes!: string[];
}
export class StocktakeRowSnapshotDto {
  @ApiPropertyOptional({ type: OpeningStocktakeResultDto, nullable: true })
  openingResult?: OpeningStocktakeResultDto | null;
  @ApiProperty({ type: String }) locationId!: string;
  @ApiProperty({ type: String }) locationCode!: string;
  @ApiProperty({ type: String }) locationName!: string;
  @ApiProperty({ type: Number }) baselineVersion!: number;
  @ApiProperty({ type: Number, nullable: true }) countVersion!: number | null;
  @ApiProperty({ type: StocktakeInventoryDto })
  baseline!: StocktakeInventoryDto;
  @ApiProperty({ type: StocktakeCountDto, nullable: true })
  count!: StocktakeCountDto | null;
  @ApiProperty({ type: String, nullable: true }) countedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) countedByEmployeeId!:
    | string
    | null;
  @ApiProperty({ type: String, nullable: true }) countedByName!: string | null;
}
export class StocktakeRowDto extends StocktakeRowSnapshotDto {
  @ApiProperty({ type: Number }) currentVersion!: number;
  @ApiProperty({ type: Boolean }) stale!: boolean;
  @ApiProperty({ type: [String] }) busyReasons!: string[];
}
export class StocktakeIssueDto {
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) message!: string;
  @ApiProperty({ type: [String] }) locationIds!: string[];
  @ApiProperty({ type: String, nullable: true }) entityId!: string | null;
}
export class StocktakeChangeDto {
  @ApiProperty({
    type: String,
    enum: [
      "raw_count",
      "box_writeoff",
      "raw_pallet_relocation",
      "box_relocation",
      "opening_raw",
      "opening_finished",
    ],
  })
  kind!: string;
  @ApiProperty({ type: String }) entityId!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String, nullable: true }) fromLocationId!: string | null;
  @ApiProperty({ type: String, nullable: true }) toLocationId!: string | null;
  @ApiProperty({ type: Number }) expectedQuantity!: number;
  @ApiProperty({ type: Number }) countedQuantity!: number;
  @ApiProperty({ type: Number }) unitsDelta!: number;
}
export class StocktakePreviewDto {
  @ApiProperty({ type: Number }) revision!: number;
  @ApiProperty({ type: Boolean }) canApprove!: boolean;
  @ApiProperty({ type: [StocktakeIssueDto] }) issues!: StocktakeIssueDto[];
  @ApiProperty({ type: [StocktakeChangeDto] }) changes!: StocktakeChangeDto[];
  @ApiProperty({ type: Number }) unitsDelta!: number;
  @ApiProperty({ type: [String] }) staleLocationIds!: string[];
}
export class StocktakeHistoryDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({
    type: String,
    enum: [
      "created",
      "claimed",
      "counted",
      "refreshed",
      "submitted",
      "approved",
      "cancelled",
    ],
  })
  kind!: string;
  @ApiProperty({ type: String }) createdAt!: string;
  @ApiProperty({ type: String }) actorEmployeeId!: string;
  @ApiProperty({ type: String }) actorName!: string;
  @ApiProperty({ type: String, nullable: true }) locationId!: string | null;
  @ApiProperty({ type: String }) message!: string;
  @ApiProperty({ type: StocktakeRowSnapshotDto, nullable: true })
  previousRow!: StocktakeRowSnapshotDto | null;
}
export class StocktakeSummaryDto {
  @ApiPropertyOptional({ type: String, enum: ["recount", "opening"] })
  mode?: "recount" | "opening";
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String, enum: STOCKTAKE_STATUSES }) status!: string;
  @ApiProperty({ type: Number }) revision!: number;
  @ApiProperty({ type: String }) createdAt!: string;
  @ApiProperty({ type: String }) createdByEmployeeId!: string;
  @ApiProperty({ type: String }) createdByName!: string;
  @ApiProperty({ type: String, nullable: true }) employeeId!: string | null;
  @ApiProperty({ type: String, nullable: true }) employeeName!: string | null;
  @ApiProperty({ type: String, nullable: true }) approvedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelledAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: Number }) locationsTotal!: number;
  @ApiProperty({ type: Number }) locationsCounted!: number;
  @ApiProperty({ type: Number }) staleLocations!: number;
}
export class StocktakeDto extends StocktakeSummaryDto {
  @ApiProperty({ type: [StocktakeRowDto] }) rows!: StocktakeRowDto[];
  @ApiProperty({ type: [StocktakeHistoryDto] }) history!: StocktakeHistoryDto[];
  @ApiProperty({ type: StocktakePreviewDto }) preview!: StocktakePreviewDto;
  @ApiProperty({ type: Boolean }) canClaim!: boolean;
  @ApiProperty({ type: Boolean }) canCount!: boolean;
  @ApiProperty({ type: Boolean }) canSubmit!: boolean;
  @ApiProperty({ type: Boolean }) canRefresh!: boolean;
  @ApiProperty({ type: Boolean }) canApprove!: boolean;
  @ApiProperty({ type: Boolean }) canCancel!: boolean;
}
export class StocktakeListDto {
  @ApiProperty({ type: [StocktakeSummaryDto] }) items!: StocktakeSummaryDto[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
}
export class StocktakeListQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page?: number;
  @ApiPropertyOptional({ type: Number, default: 25 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
  @ApiPropertyOptional({ type: String, enum: ["active", "archive"] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(["active", "archive"])
  bucket?: string;
  @ApiPropertyOptional({ type: String, enum: STOCKTAKE_STATUSES })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(STOCKTAKE_STATUSES)
  status?: string;
}
export class CreateStocktakeDto extends CommandDto {
  @ApiPropertyOptional({
    type: String,
    enum: ["recount", "opening"],
    default: "recount",
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(["recount", "opening"])
  mode?: "recount" | "opening";
  @ApiProperty({ type: [String], maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(150, { each: true })
  locationIds!: string[];
}
export class StocktakeCommandDto extends CommandDto {
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision!: number;
}
export class CountStocktakeLocationDto extends StocktakeCommandDto {
  @ApiPropertyOptional({ type: OpeningPalletCountDto, nullable: true })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @ValidateNested()
  @Type(() => OpeningPalletCountDto)
  openingPallet?: OpeningPalletCountDto | null;
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  locationCode!: string;
  @ApiProperty({ type: [StocktakeRawCountDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StocktakeRawCountDto)
  rawPallets!: StocktakeRawCountDto[];
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(150, { each: true })
  boxCodes!: string[];
}
export class ReasonStocktakeDto extends StocktakeCommandDto {
  @ApiPropertyOptional({ type: [String], maxItems: 200 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(150, { each: true })
  openingCompleteSkuIds?: string[];
  @ApiProperty({ type: String, minLength: 5, maxLength: 500 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class CreateWorkZoneDto extends CommandDto {
  @ApiProperty({ type: String })
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MaxLength(80)
  code!: string;
  @ApiProperty({ type: String })
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MaxLength(160)
  name!: string;
  @ApiProperty({ type: String, enum: WORK_ZONE_KINDS })
  @IsIn(WORK_ZONE_KINDS)
  kind!: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(150, { each: true })
  locationIds!: string[];
}
export class UpdateWorkZoneDto extends CommandDto {
  @ApiPropertyOptional({ type: String })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MinLength(1)
  @MaxLength(80)
  code?: string;
  @ApiPropertyOptional({ type: String })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  name?: string;
  @ApiPropertyOptional({ type: String, enum: WORK_ZONE_KINDS })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(WORK_ZONE_KINDS)
  kind?: string;
  @ApiPropertyOptional({ type: [String] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(150, { each: true })
  locationIds?: string[];
}
export class StartZoneWorkDto extends ClaimTaskDto {
  @ApiProperty({
    type: String,
    description: "Только QR artmate-wms:work-zone:<id>",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  zoneCode!: string;
  @ApiPropertyOptional({
    enum: ["open-queue", "take-next", "show-offer", "take-job"],
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(["open-queue", "take-next", "show-offer", "take-job"])
  intent?: "open-queue" | "take-next" | "show-offer" | "take-job";
  @ApiPropertyOptional({ type: String })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  expectedJobId?: string;
  @ApiPropertyOptional({ type: String })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  expectedPalletId?: string;
}
export class ScanShipmentWorkDto extends ClaimTaskDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  boxCode!: string;
}
export class ImportWbShipmentDto extends CommandDto {
  @ApiProperty({ type: String })
  @IsString()
  @Matches(/^[1-9]\d{0,19}$/)
  supplyId!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  sourceShipmentIds!: string[];
}
export class AssignWbShipmentDto extends ClaimTaskDto {}
export class FinishShipmentWorkDto extends StartZoneWorkDto {}

export class CreateBoxLabelBatchDto extends CommandDto {
  @ApiProperty({ type: Number, minimum: 1, maximum: 1000, example: 100 })
  @IsInt()
  @Min(1)
  @Max(1000)
  count!: number;
}
export class BoxLabelBatchDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: Number }) count!: number;
  @ApiProperty({ type: Number }) freeCount!: number;
  @ApiProperty({ type: Number }) assignedCount!: number;
  @ApiProperty({ type: String }) createdAt!: string;
}
export class BoxLabelBatchQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number;
  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
export class BoxLabelQueryDto extends BoxLabelBatchQueryDto {
  @ApiPropertyOptional({ enum: ["free", "assigned"] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(["free", "assigned"])
  status?: "free" | "assigned";
}
export class BoxLabelBatchListDto {
  @ApiProperty({ type: [BoxLabelBatchDto] }) items!: BoxLabelBatchDto[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
}
export class PreprintedBoxLabelDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) payload!: string;
  @ApiProperty({ type: String }) svg!: string;
  @ApiProperty({ enum: ["free", "assigned"] }) status!: "free" | "assigned";
  @ApiProperty({ type: String, nullable: true }) taskId!: string | null;
  @ApiProperty({ type: String, nullable: true }) boxId!: string | null;
}
export class BoxLabelPageDto {
  @ApiProperty({ type: BoxLabelBatchDto }) batch!: BoxLabelBatchDto;
  @ApiProperty({ type: [PreprintedBoxLabelDto] })
  items!: PreprintedBoxLabelDto[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
}

export class CreatePalletLabelBatchDto extends CreateBoxLabelBatchDto {}
export class PalletLabelBatchDto extends BoxLabelBatchDto {}
export class PalletLabelBatchQueryDto extends BoxLabelBatchQueryDto {}
export class PalletLabelQueryDto extends PalletLabelBatchQueryDto {
  @ApiPropertyOptional({ enum: ["free", "assigned"] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(["free", "assigned"])
  status?: "free" | "assigned";
}
export class PalletLabelBatchListDto {
  @ApiProperty({ type: [PalletLabelBatchDto] }) items!: PalletLabelBatchDto[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
}
export class PalletLabelDto {
  @ApiProperty({ type: Number, minimum: 1 }) ordinal!: number;
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) payload!: string;
  @ApiProperty({ type: String }) svg!: string;
  @ApiProperty({ enum: ["free", "assigned"] }) status!: "free" | "assigned";
  @ApiProperty({ type: String, nullable: true }) palletId!: string | null;
  @ApiProperty({ type: String, nullable: true }) receiptId!: string | null;
}
export class PalletLabelPageDto {
  @ApiProperty({ type: PalletLabelBatchDto }) batch!: PalletLabelBatchDto;
  @ApiProperty({ type: [PalletLabelDto] }) items!: PalletLabelDto[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
}
export class BindReceiptPalletLabelDto extends CommandDto {
  @ApiProperty({ type: String }) @IsString() @MinLength(1) employeeId!: string;
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  labelCode!: string;
}

export const TASK_HISTORY_KINDS = [
  "assembly",
  "receiving",
  "putaway",
  "movement",
  "shipping",
  "stocktake",
] as const;
export type TaskHistoryKind = (typeof TASK_HISTORY_KINDS)[number];

export class TaskHistoryQueryDto {
  @ApiProperty({ enum: TASK_HISTORY_KINDS, type: String })
  @IsIn(TASK_HISTORY_KINDS)
  kind!: TaskHistoryKind;
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  id!: string;
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 1000000 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number;
}
export class RecordTaskScanDto extends CommandDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  declare requestId: string;
  @ApiProperty({ enum: TASK_HISTORY_KINDS, type: String })
  @IsIn(TASK_HISTORY_KINDS)
  kind!: TaskHistoryKind;
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  id!: string;
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  value!: string;
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  step!: string;
}
export class TaskHistoryEntryDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String, format: "date-time" }) receivedAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) recordedAt!: string;
  @ApiProperty({ type: String, nullable: true }) employeeName!: string | null;
  @ApiProperty({ type: String }) action!: string;
  @ApiProperty({ type: String, nullable: true }) scanValue!: string | null;
  @ApiProperty({ type: String, enum: ["accepted", "rejected", "observed"] })
  result!: "accepted" | "rejected" | "observed";
  @ApiProperty({ type: String }) detail!: string;
}
export class TaskHistoryPageDto {
  @ApiProperty({ type: String, format: "date-time" }) since!: string;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: [TaskHistoryEntryDto] }) items!: TaskHistoryEntryDto[];
}
