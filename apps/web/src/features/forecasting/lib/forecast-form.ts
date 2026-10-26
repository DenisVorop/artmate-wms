import { z } from "zod";
export const forecastPolicySchema = z.object({
  minimumBoxes: z
    .number({ invalid_type_error: "Укажите количество коробов" })
    .int("Только целые короба")
    .min(0, "Не меньше нуля")
    .max(1000, "Максимум 1000 коробов"),
  seasonalityEnabled: z.boolean(),
});
export type ForecastPolicyValues = z.infer<typeof forecastPolicySchema>;
export const financeSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(1, "Введите ключ WB")
    .max(8192, "Проверьте длину ключа"),
});
export type FinanceValues = z.infer<typeof financeSchema>;
export function historyPeriod(now = new Date()) {
  return {
    from: "2024-01-29",
    to: new Date(now.getTime() + 3 * 3600000 - 86400000)
      .toISOString()
      .slice(0, 10),
  };
}

export function policyCommand(
  skuId: string,
  values: ForecastPolicyValues,
  requestId: string,
) {
  return { requestId, skuId, ...forecastPolicySchema.parse(values) };
}
