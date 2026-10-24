import { z } from "zod";
import type { PackagingProfileDto } from "@/shared/api/generated/model";
const dimension = z.number().int().positive().max(5000);
export const packagingSchema = z.object({
  boxWidthMm: dimension,
  boxDepthMm: dimension,
  boxHeightMm: dimension,
  palletWidthMm: dimension.min(100),
  palletDepthMm: dimension.min(100),
  palletBaseHeightMm: dimension.max(1000),
  boxesPerLayer: z.number().int().min(1).max(500),
  maxLayers: z.number().int().min(1).max(100),
  boxWeightKg: z.number().positive().max(10000).nullable(),
  palletWeightKg: z.number().positive().max(10000).nullable(),
});
export type PackagingValues = z.infer<typeof packagingSchema>;
export function buildPackaging(values: PackagingValues): {
  requestId: string;
  packaging: PackagingProfileDto;
} {
  return { requestId: crypto.randomUUID(), packaging: { ...values } };
}
