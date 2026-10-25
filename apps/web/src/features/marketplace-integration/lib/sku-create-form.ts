import { z } from "zod";
import type { CreateSkuDto } from "@/shared/api/generated/model";

export const skuCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Укажите название тематики")
    .max(100, "Не больше 100 символов"),
  barcode: z
    .string()
    .trim()
    .min(1, "Укажите штрихкод товара")
    .max(150, "Не больше 150 символов"),
  unitsPerBox: z
    .number({ invalid_type_error: "Укажите количество товара" })
    .int("Только целое количество")
    .min(1, "Минимум 1 единица")
    .max(1000, "Максимум 1 000 единиц"),
});
export type SkuCreateValues = z.infer<typeof skuCreateSchema>;
export const skuCreateDefaults: SkuCreateValues = {
  name: "",
  barcode: "",
  unitsPerBox: 20,
};
export function skuCreatePayload(
  values: SkuCreateValues,
): Omit<CreateSkuDto, "requestId"> {
  return skuCreateSchema.parse(values);
}
