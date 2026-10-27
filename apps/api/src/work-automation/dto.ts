import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";
import { CommandDto } from "../dto";
export class WorkAutomationStatusDto {
  @ApiProperty({ type: Boolean }) enabled!: boolean;
  @ApiProperty({ type: String, nullable: true }) lastCheckedAt!: string | null;
  @ApiProperty({ type: Number }) queuedAssemblyTasks!: number;
  @ApiProperty({ type: Number }) queuedPutawayTasks!: number;
  @ApiProperty({ type: Number }) assemblyBoxes!: number;
  @ApiProperty({ type: Number, nullable: true }) assemblyCapacityBoxes!:
    | number
    | null;
  @ApiProperty({
    type: String,
    enum: ["normal", "near_full", "full", "unavailable"],
  })
  pressure!: "normal" | "near_full" | "full" | "unavailable";
  @ApiProperty({ type: String }) message!: string;
  @ApiProperty({ type: [String] }) blockers!: string[];
}
export class UpdateWorkAutomationSettingsDto extends CommandDto {
  @ApiProperty({ type: Boolean }) @IsBoolean() enabled!: boolean;
}
