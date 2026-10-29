import { z } from "zod";
import type { PackagingProfileDto } from "@/shared/api/generated/model";
const dimension = z
  .number({ invalid_type_error: "Укажите размер" })
  .int("Нужно целое число")
  .positive("Размер должен быть больше нуля")
  .max(5000, "Не больше 5000 мм");
export const packagingSchema = z
  .object({
    boxWidthMm: dimension,
    boxDepthMm: dimension,
    boxHeightMm: dimension,
    palletWidthMm: dimension.min(100),
    palletDepthMm: dimension.min(100),
    loadWidthMm: dimension.min(100),
    loadDepthMm: dimension.min(100),
    palletBaseHeightMm: dimension.max(1000),
    boxesPerLayer: z.number().int().min(1).max(500),
    maxLayers: z.number().int().min(1).max(100),
    boxWeightKg: z.number().positive().max(10000).nullable(),
    palletWeightKg: z.number().positive().max(10000).nullable(),
  })
  .superRefine((values, context) => {
    for (const [load, base] of [
      ["loadWidthMm", "palletWidthMm"],
      ["loadDepthMm", "palletDepthMm"],
    ] as const)
      if (values[load] < values[base])
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [load],
          message: "Размер груза с поддоном не может быть меньше поддона",
        });
  });
export type PackagingValues = z.infer<typeof packagingSchema>;
/** Old profiles keep their measured base and use it as the missing load envelope. */
export function packagingDefaults(
  profile?: PackagingProfileDto,
): PackagingValues {
  const current = profile ?? {
    boxWidthMm: 450,
    boxDepthMm: 350,
    boxHeightMm: 200,
    palletWidthMm: 1200,
    palletDepthMm: 800,
    loadWidthMm: 1200,
    loadDepthMm: 900,
    palletBaseHeightMm: 150,
    boxesPerLayer: 6,
    maxLayers: 7,
    boxWeightKg: null,
    palletWeightKg: null,
  };
  return {
    ...current,
    loadWidthMm: current.loadWidthMm ?? current.palletWidthMm,
    loadDepthMm: current.loadDepthMm ?? current.palletDepthMm,
  };
}
export function buildPackaging(values: PackagingValues): {
  requestId: string;
  packaging: PackagingProfileDto;
} {
  return { requestId: crypto.randomUUID(), packaging: { ...values } };
}
