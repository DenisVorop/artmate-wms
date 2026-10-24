import { z } from "zod";
import type {
  CreateRackLevelDto,
  CreateRackSectionDto,
  LocationDto,
  RackSectionDto,
  UpdateRackSectionDto,
} from "@/shared/api/generated/model";
import {
  DEFAULT_STORAGE_FOOTPRINT,
  geometrySchema,
  levelProfileSchema,
  profileDefaults,
  type LevelProfileValues,
} from "./location-form";

export const sectionSchema = geometrySchema
  .extend({
    code: z.string().trim().min(1, "Укажите код секции").max(40),
    name: z.string().trim().min(1, "Укажите название").max(100),
    levels: z.array(levelProfileSchema).max(20, "Максимум 20 ярусов"),
  })
  .superRefine((values, ctx) => {
    const codes = new Set<string>();
    values.levels.forEach((level, index) => {
      if (codes.has(level.code.toLowerCase()))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["levels", index, "code"],
          message: "Адреса ярусов должны различаться",
        });
      codes.add(level.code.toLowerCase());
    });
  });
// Profiles are edited separately. Hidden legacy/archived profile fields must not
// prevent a geometry-only update; the update mapper never sends this array.
export const sectionEditSchema = geometrySchema.extend({
  code: z.string().trim().min(1, "Укажите код секции").max(40),
  name: z.string().trim().min(1, "Укажите название").max(100),
  levels: z.custom<LevelProfileValues[]>(),
});
export const newSectionSchema = sectionSchema.superRefine((values, ctx) => {
  if (!values.levels.length)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["levels"],
      message: "Нужен хотя бы один ярус",
    });
});
export type SectionFormValues = z.infer<typeof sectionSchema>;
export function nextLevelDefaults(
  section: RackSectionDto,
  locations: LocationDto[],
): LevelProfileValues {
  const number =
    Math.max(0, ...locations.map((location) => location.level)) + 1;
  const previous = [...locations].sort((a, b) => b.level - a.level)[0];
  return {
    ...profileDefaults(previous),
    code: `${section.code}-${String(number).padStart(2, "0")}`,
    name: `${section.name} · Ярус ${number}`,
  };
}
export function sectionDefaults(
  section?: RackSectionDto,
  locations: LocationDto[] = [],
  generated?: Pick<RackSectionDto, "code" | "name">,
): SectionFormValues {
  const code = section?.code ?? generated?.code ?? "";
  const name = section?.name ?? generated?.name ?? "";
  return {
    code,
    name,
    x: section?.x ?? 2,
    y: section?.y ?? 2,
    width: section?.width ?? DEFAULT_STORAGE_FOOTPRINT.width,
    depth: section?.depth ?? DEFAULT_STORAGE_FOOTPRINT.depth,
    rotation: section?.rotation ?? 0,
    levels: section
      ? locations.filter((location) => !location.archived).map(profileDefaults)
      : [
          {
            ...profileDefaults(),
            code: code ? `${code}-01` : "",
            name: name ? `${name} · Ярус 1` : "",
          },
        ],
  };
}
export function toCreateSection(
  values: SectionFormValues,
): CreateRackSectionDto {
  return { ...values, requestId: crypto.randomUUID() };
}
export function toUpdateSection(
  values: SectionFormValues,
): UpdateRackSectionDto {
  const { code, name, x, y, width, depth, rotation } = values;
  return {
    code,
    name,
    x,
    y,
    width,
    depth,
    rotation,
    requestId: crypto.randomUUID(),
  };
}
export function toCreateLevel(values: LevelProfileValues): CreateRackLevelDto {
  return { ...values, requestId: crypto.randomUUID() };
}
