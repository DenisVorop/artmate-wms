import { z } from "zod";

export const stocktakeCreateSchema = z
  .object({
    scope: z.enum(["room", "section", "locations"]),
    scopeId: z.string(),
    locationIds: z.array(z.string()),
  })
  .superRefine((values, ctx) => {
    if (values.scope !== "locations" && !values.scopeId)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scopeId"],
        message: "Выберите помещение или секцию",
      });
    if (values.scope === "locations" && !values.locationIds.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locationIds"],
        message: "Выберите хотя бы один адрес",
      });
  });
export type StocktakeCreateValues = z.infer<typeof stocktakeCreateSchema>;
export const stocktakeReasonSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Опишите причину: минимум 5 символов")
    .max(500, "Не больше 500 символов"),
});
export type StocktakeReasonValues = z.infer<typeof stocktakeReasonSchema>;

export function validateScopeSize(count: number): string | null {
  return count === 0
    ? "В выбранной области нет действующих адресов хранения"
    : count > 200
      ? "Один документ может включать не больше 200 адресов. Выберите меньшую область."
      : null;
}
