import { z } from "zod";
import {
  CreateLocationDtoKind,
  LocationDtoKind,
} from "@/shared/api/generated/model";
import type {
  CreateLocationDto,
  LocationDto,
  UpdateLocationDto,
} from "@/shared/api/generated/model";

const kindLabels: Record<string, string> = {
  rack: "Стеллаж",
  floor: "Напольное место",
  receiving: "Приёмка",
  assembly: "Сборка",
  shipping: "Отгрузка",
  picking: "Зона отбора",
};
export const locationKindLabel = (kind: string) => kindLabels[kind] ?? kind;
export const standaloneLocationKinds = Object.values(CreateLocationDtoKind);
const number = () => z.number({ invalid_type_error: "Укажите число" });
const code = z
  .string()
  .trim()
  .min(1, "Укажите адрес")
  .max(40, "Не больше 40 символов");
const name = z
  .string()
  .trim()
  .min(1, "Укажите название")
  .max(100, "Не больше 100 символов");

export const DEFAULT_STORAGE_FOOTPRINT = {
  width: 1.2,
  depth: 0.9,
  rotation: 0,
} as const;
export const MIN_STORAGE_SIZE_METERS = 0.1;

export const rotationSchema = z.union(
  [z.literal(0), z.literal(90), z.literal(180), z.literal(270)],
  { errorMap: () => ({ message: "Выберите 0°, 90°, 180° или 270°" }) },
);
export const geometrySchema = z.object({
  rotation: rotationSchema,
  x: number().min(0, "Минимум 0").max(1000),
  y: number().min(0, "Минимум 0").max(1000),
  width: number().min(MIN_STORAGE_SIZE_METERS, "Минимум 0,1 м").max(1000),
  depth: number().min(MIN_STORAGE_SIZE_METERS, "Минимум 0,1 м").max(1000),
});
export const levelProfileSchema = z.object({
  code,
  name,
  maxHeightMm: number()
    .int("Нужно целое число")
    .min(100, "Минимум 100 мм")
    .max(10000),
  maxBoxes: number()
    .int("Нужно целое число")
    .min(1, "Минимум 1 короб")
    .max(1000),
  availableWidthMm: number()
    .int("Нужно целое число")
    .min(100, "Минимум 100 мм")
    .max(10000),
  availableDepthMm: number()
    .int("Нужно целое число")
    .min(100, "Минимум 100 мм")
    .max(10000),
  maxWeightKg: number()
    .positive("Укажите массу больше нуля")
    .max(100000)
    .nullable(),
  accessSides: number().int().min(1).max(4),
});
export const locationSchema = geometrySchema
  .merge(levelProfileSchema)
  .extend({
    kind: z.nativeEnum(LocationDtoKind),
    blocked: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (values.kind === LocationDtoKind.picking && values.accessSides !== 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accessSides"],
        message: "Для зоны отбора нужен доступ с четырёх сторон",
      });
    }
  });
export type LocationFormValues = z.infer<typeof locationSchema>;
export type LevelProfileValues = z.infer<typeof levelProfileSchema>;

export function profileDefaults(location?: LocationDto): LevelProfileValues {
  return {
    code: location?.code ?? "",
    name: location?.name ?? "",
    maxHeightMm: location?.maxHeightMm ?? 1800,
    maxBoxes: location?.maxBoxes ?? 42,
    availableWidthMm: location?.availableWidthMm ?? 1200,
    availableDepthMm: location?.availableDepthMm ?? 900,
    maxWeightKg: location?.maxWeightKg ?? null,
    accessSides: location?.accessSides ?? 1,
  };
}
export function locationDefaults(
  location?: LocationDto,
  suggestedPosition?: { x: number; y: number },
  generatedIdentity?: { code: string; name: string },
): LocationFormValues {
  return {
    ...profileDefaults(location),
    ...(!location && generatedIdentity ? generatedIdentity : {}),
    kind: location?.kind ?? LocationDtoKind.floor,
    x: location?.x ?? suggestedPosition?.x ?? 2,
    y: location?.y ?? suggestedPosition?.y ?? 2,
    width: location?.width ?? DEFAULT_STORAGE_FOOTPRINT.width,
    depth: location?.depth ?? DEFAULT_STORAGE_FOOTPRINT.depth,
    blocked: location?.blocked ?? false,
    rotation: location?.rotation ?? 0,
  };
}
export function toCreateLocation(
  values: LocationFormValues,
): CreateLocationDto {
  const kind = standaloneLocationKinds.find((kind) => kind === values.kind);
  if (!kind) throw new Error("Создайте стеллаж через отдельную форму секции");
  return { ...values, kind, levels: 1, requestId: crypto.randomUUID() };
}
export function toUpdateLocation(
  values: LocationFormValues,
  isRack: boolean,
): UpdateLocationDto {
  const {
    code,
    name,
    maxHeightMm,
    maxBoxes,
    availableWidthMm,
    availableDepthMm,
    maxWeightKg,
    accessSides,
    blocked,
  } = values;
  return {
    code,
    name,
    maxHeightMm,
    maxBoxes,
    availableWidthMm,
    availableDepthMm,
    maxWeightKg,
    accessSides,
    blocked,
    ...(!isRack
      ? {
          rotation: values.rotation,
          kind: values.kind,
          x: values.x,
          y: values.y,
          width: values.width,
          depth: values.depth,
        }
      : {}),
    requestId: crypto.randomUUID(),
  };
}
export function suggestLocationPosition(
  objects: { x: number; y: number; width: number; depth: number }[],
): { x: number; y: number } {
  const { width, depth } = DEFAULT_STORAGE_FOOTPRINT;
  const gap = 0.25;
  for (let y = 0.5; y + depth <= 16; y += 0.5) {
    for (let x = 0.5; x + width <= 24; x += 0.5) {
      if (
        !objects.some(
          (item) =>
            x < item.x + item.width + gap &&
            x + width + gap > item.x &&
            y < item.y + item.depth + gap &&
            y + depth + gap > item.y,
        )
      )
        return { x, y };
    }
  }
  return {
    x: 0.5,
    y: Math.ceil(
      Math.max(16, ...objects.map((item) => item.y + item.depth)) + 1,
    ),
  };
}
