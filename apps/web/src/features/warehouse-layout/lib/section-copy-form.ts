import { z } from "zod";
export const sectionCopyPlacementSchema = z.object({
  x: z
    .number({ invalid_type_error: "Укажите координату X" })
    .finite("Укажите конечное число")
    .min(0, "Минимум 0 м")
    .max(1000, "Максимум 1000 м"),
  y: z
    .number({ invalid_type_error: "Укажите координату Y" })
    .finite("Укажите конечное число")
    .min(0, "Минимум 0 м")
    .max(1000, "Максимум 1000 м"),
});
export type SectionCopyPlacementValues = z.infer<
  typeof sectionCopyPlacementSchema
>;
