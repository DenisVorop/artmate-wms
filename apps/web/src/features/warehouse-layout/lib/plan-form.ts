import { z } from "zod";
import type {
  AisleDto,
  CreateAisleDto,
  CreateEntranceDto,
  EntranceDto,
  UpdateWarehousePlanDto,
  WarehousePlanDto,
} from "@/shared/api/generated/model";
import { geometrySchema } from "./location-form";

const number = () => z.number({ invalid_type_error: "Укажите число" });
const name = z
  .string()
  .trim()
  .min(1, "Укажите название")
  .max(100, "Не больше 100 символов");
export const warehousePlanSchema = z.object({
  name,
  width: number().min(1, "Минимум 1 м").max(1000),
  depth: number().min(1, "Минимум 1 м").max(1000),
});
export type WarehousePlanValues = z.infer<typeof warehousePlanSchema>;
export const aisleSchema = geometrySchema.extend({
  name,
  width: number().min(0.5, "Минимум 0,5 м").max(1000),
  depth: number().min(0.5, "Минимум 0,5 м").max(1000),
});
export type AisleValues = z.infer<typeof aisleSchema>;
export const entranceSchema = z.object({
  name,
  spaceId: z.string().nullable(),
  wall: z.enum(["north", "east", "south", "west"]),
  offset: number().min(0, "Минимум 0 м").max(1000),
  width: number().min(0.5, "Минимум 0,5 м").max(1000),
});
export type EntranceValues = z.infer<typeof entranceSchema>;
export const wallLabels: Record<EntranceValues["wall"], string> = {
  north: "Верхняя стена",
  east: "Правая стена",
  south: "Нижняя стена",
  west: "Левая стена",
};
export function entranceFrame(
  warehouse: WarehousePlanDto,
  spaceId: string | null,
) {
  if (warehouse.layoutMode === "spaces")
    return (
      warehouse.spaces.find(
        (space) => !space.archived && space.id === spaceId,
      ) ?? null
    );
  return spaceId === null ? { ...warehouse, x: 0, y: 0 } : null;
}
export function entranceSchemaFor(
  warehouse: WarehousePlanDto,
  entrances: EntranceDto[] = [],
  editedId?: string,
) {
  return entranceSchema.superRefine((values, ctx) => {
    const frame = entranceFrame(warehouse, values.spaceId);
    if (!frame) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["spaceId"],
        message:
          warehouse.layoutMode === "spaces"
            ? "Выберите активное помещение или коридор"
            : "В прямоугольной схеме вход относится к общему контуру",
      });
      return;
    }
    const length =
      values.wall === "north" || values.wall === "south"
        ? frame.width
        : frame.depth;
    if (values.offset + values.width - length > 1e-9)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["offset"],
        message: `Проём выходит за стену длиной ${length} м`,
      });
    const current = _opening(warehouse, values);
    if (
      current &&
      entrances.some((entrance) => {
        if (entrance.archived || entrance.id === editedId) return false;
        const other = _opening(warehouse, entrance);
        return (
          other &&
          current.horizontal === other.horizontal &&
          Math.abs(current.wallAt - other.wallAt) < 1e-9 &&
          current.start < other.end - 1e-9 &&
          current.end > other.start + 1e-9
        );
      })
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["offset"],
        message:
          "Проём совпадает или пересекается с другим входом на этой стене",
      });
  });
}
export function aisleDefaults(aisle?: AisleDto): AisleValues {
  return {
    name: aisle?.name ?? "",
    x: aisle?.x ?? 0,
    y: aisle?.y ?? 0,
    width: aisle?.width ?? 2,
    depth: aisle?.depth ?? 3,
    rotation: aisle?.rotation ?? 0,
  };
}
export function entranceDefaults(entrance?: EntranceDto): EntranceValues {
  return {
    name: entrance?.name ?? "",
    spaceId: entrance?.spaceId ?? null,
    wall: entrance?.wall ?? "north",
    offset: entrance?.offset ?? 0,
    width: entrance?.width ?? 1.5,
  };
}
export function toWarehousePlan(
  values: WarehousePlanValues,
): UpdateWarehousePlanDto {
  return { ...values, requestId: crypto.randomUUID() };
}
export function toAisle(values: AisleValues): CreateAisleDto {
  return { ...values, requestId: crypto.randomUUID() };
}
export function toEntrance(values: EntranceValues): CreateEntranceDto {
  return { ...values, requestId: crypto.randomUUID() };
}

type OpeningInput = Pick<
  EntranceValues,
  "spaceId" | "wall" | "offset" | "width"
>;
function _opening(warehouse: WarehousePlanDto, entrance: OpeningInput) {
  const frame = entranceFrame(warehouse, entrance.spaceId);
  if (!frame) return null;
  const horizontal = entrance.wall === "north" || entrance.wall === "south";
  const start = (horizontal ? frame.x : frame.y) + entrance.offset;
  const wallAt = horizontal
    ? frame.y + (entrance.wall === "south" ? frame.depth : 0)
    : frame.x + (entrance.wall === "east" ? frame.width : 0);
  return { horizontal, start, end: start + entrance.width, wallAt };
}
export function suggestEntrancePosition(
  warehouse: WarehousePlanDto,
  entrances: EntranceDto[],
  width: number,
  spaceId: string | null = null,
): Pick<EntranceValues, "wall" | "offset"> | null {
  const frame = entranceFrame(warehouse, spaceId);
  if (!frame) return null;
  for (const wall of ["north", "east", "south", "west"] as const) {
    const length =
      wall === "north" || wall === "south" ? frame.width : frame.depth;
    const probe = _opening(warehouse, { spaceId, wall, offset: 0, width })!;
    const intervals = entrances
      .filter((entrance) => !entrance.archived)
      .map((entrance) => _opening(warehouse, entrance))
      .filter(
        (opening) =>
          opening &&
          opening.horizontal === probe.horizontal &&
          Math.abs(opening.wallAt - probe.wallAt) < 1e-9,
      )
      .map((opening) => ({
        start: Math.max(0, opening!.start - probe.start),
        end: Math.min(length, opening!.end - probe.start),
      }))
      .filter((interval) => interval.end - interval.start > 1e-9)
      .sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const interval of intervals) {
      if (interval.start - cursor + 1e-9 >= width)
        return { wall, offset: cursor };
      cursor = Math.max(cursor, interval.end);
    }
    if (cursor + width - length <= 1e-9) return { wall, offset: cursor };
  }
  return null;
}
export function newEntranceDefaults(
  warehouse: WarehousePlanDto,
  entrances: EntranceDto[],
): EntranceValues {
  const frames =
    warehouse.layoutMode === "spaces"
      ? warehouse.spaces
          .filter((space) => !space.archived)
          .map((space) => ({ ...space, spaceId: space.id }))
      : [{ ...warehouse, spaceId: null }];
  for (const frame of frames) {
    const width = Math.min(1.5, Math.max(frame.width, frame.depth));
    const position = suggestEntrancePosition(
      warehouse,
      entrances,
      width,
      frame.spaceId,
    );
    if (position)
      return {
        ...entranceDefaults(),
        spaceId: frame.spaceId,
        width,
        ...position,
      };
  }
  return { ...entranceDefaults(), spaceId: frames[0]?.spaceId ?? null };
}
