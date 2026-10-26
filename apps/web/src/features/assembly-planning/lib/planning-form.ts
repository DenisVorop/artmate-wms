import { z } from "zod";

export const planningSchema = z.object({
  historyDays: z
    .number({ invalid_type_error: "Укажите количество дней" })
    .int()
    .min(7, "Минимум 7 дней")
    .max(89, "Максимум 89 дней"),
  horizonDays: z
    .number({ invalid_type_error: "Укажите количество дней" })
    .int()
    .min(1, "Минимум 1 день")
    .max(90, "Максимум 90 дней"),
  safetyDays: z
    .number({ invalid_type_error: "Укажите количество дней" })
    .int()
    .min(0, "Не меньше 0 дней")
    .max(60, "Максимум 60 дней"),
  leadDays: z
    .number({ invalid_type_error: "Укажите количество дней" })
    .int()
    .min(0, "Не меньше 0 дней")
    .max(60, "Максимум 60 дней"),
});
export type PlanningValues = z.infer<typeof planningSchema>;
export const planningDefaults: PlanningValues = {
  historyDays: 28,
  horizonDays: 14,
  safetyDays: 3,
  leadDays: 7,
};
export const transitSchema = z.object({
  inTransitUnits: z
    .number({ invalid_type_error: "Укажите количество товара" })
    .int("Только целое количество")
    .min(0, "Не меньше нуля")
    .max(100000000, "Слишком большое количество"),
});
export type TransitValues = z.infer<typeof transitSchema>;

export const stockConfirmationSchema = z.object({
  units: z
    .number({ invalid_type_error: "Укажите количество готового товара" })
    .int("Только целое количество")
    .min(0, "Не меньше нуля")
    .max(100000000, "Слишком большое количество"),
});
export type StockConfirmationValues = z.infer<typeof stockConfirmationSchema>;
export const stockConfirmationEntry = (
  skuId: string,
  values: StockConfirmationValues,
) => ({
  skuId,
  enabled: true,
  units: values.units,
  accuracy: "exact" as const,
  note: "Пересчёт готового товара руководителем",
});
