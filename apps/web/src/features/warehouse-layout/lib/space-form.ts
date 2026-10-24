import { z } from "zod";
import type {
  CreateSpaceDto,
  WarehousePlanDto,
  WarehouseSpaceDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import { rotatedFootprint } from "./plan-geometry";

const number = () =>
  z
    .number({ invalid_type_error: "Укажите число" })
    .finite("Укажите конечное число");
export const spaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Укажите название участка")
    .max(100, "Не больше 100 символов"),
  kind: z.enum(["room", "corridor"]),
  x: number().min(0, "Минимум 0 м").max(1000),
  y: number().min(0, "Минимум 0 м").max(1000),
  width: number().min(0.5, "Минимум 0,5 м").max(1000),
  depth: number().min(0.5, "Минимум 0,5 м").max(1000),
});
export type SpaceValues = z.infer<typeof spaceSchema>;
export type SpaceDraft = Pick<
  SpaceValues,
  "kind" | "x" | "y" | "width" | "depth"
>;
export const spaceKindLabels: Record<SpaceValues["kind"], string> = {
  room: "Помещение",
  corridor: "Коридор",
};
export function spaceSchemaFor(warehouse: WarehousePlanDto, editedId?: string) {
  return spaceSchema.superRefine((values, ctx) => {
    if (values.x + values.width - warehouse.width > 1e-9)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["width"],
        message: "Участок выходит за ширину плана",
      });
    if (values.y + values.depth - warehouse.depth > 1e-9)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["depth"],
        message: "Участок выходит за глубину плана",
      });
    const conflict = warehouse.spaces.find(
      (space) =>
        !space.archived &&
        space.id !== editedId &&
        values.x < space.x + space.width - 1e-9 &&
        values.x + values.width > space.x + 1e-9 &&
        values.y < space.y + space.depth - 1e-9 &&
        values.y + values.depth > space.y + 1e-9,
    );
    if (conflict)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["x"],
        message: `Участок пересекается с «${conflict.name}»`,
      });
  });
}
export function spaceDefaults(
  space?: WarehouseSpaceDto,
  draft?: SpaceDraft,
): SpaceValues {
  return {
    name: space?.name ?? "",
    kind: space?.kind ?? draft?.kind ?? "room",
    x: space?.x ?? draft?.x ?? 0,
    y: space?.y ?? draft?.y ?? 0,
    width: space?.width ?? draft?.width ?? 4,
    depth: space?.depth ?? draft?.depth ?? 3,
  };
}
export function toSpace(values: SpaceValues): CreateSpaceDto {
  const { name, kind, x, y, width, depth } = values;
  return { name, kind, x, y, width, depth, requestId: crypto.randomUUID() };
}

/** A UI explanation only; the server validates the whole resulting floor. */
export function spaceArchiveReasons(
  data: WorkspaceDto,
  space: WarehouseSpaceDto,
): string[] {
  const reasons: string[] = [];
  const overlaps = (object: {
    x: number;
    y: number;
    width: number;
    depth: number;
    rotation: number;
  }) => {
    const size = rotatedFootprint(object);
    return (
      space.x < object.x + size.width - 1e-9 &&
      space.x + space.width > object.x + 1e-9 &&
      space.y < object.y + size.depth - 1e-9 &&
      space.y + space.depth > object.y + 1e-9
    );
  };
  if (data.warehouse.layoutMode === "spaces") {
    const sections = data.sections.filter(
      (section) => !section.archived && overlaps(section),
    );
    if (sections.length)
      reasons.push(
        `Внутри есть активные секции: ${sections.map((section) => section.code).join(", ")}.`,
      );
    const addresses = data.locations.filter(
      (location) =>
        !location.archived && location.sectionId === null && overlaps(location),
    );
    if (addresses.length)
      reasons.push(
        `Внутри есть активные адреса: ${addresses.map((location) => location.code).join(", ")}.`,
      );
    const aisles = data.aisles.filter(
      (aisle) => !aisle.archived && overlaps(aisle),
    );
    if (aisles.length)
      reasons.push(
        `Внутри есть проходы: ${aisles.map((aisle) => aisle.name).join(", ")}.`,
      );
  }
  const entrances = data.entrances.filter(
    (entrance) => !entrance.archived && entrance.spaceId === space.id,
  );
  if (entrances.length)
    reasons.push(
      `К участку привязаны входы: ${entrances.map((entrance) => entrance.name).join(", ")}.`,
    );
  return reasons;
}
