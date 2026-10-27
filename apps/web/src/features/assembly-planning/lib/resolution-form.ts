import { z } from "zod";
import type { SetMarketplaceResolutionDto } from "@/shared/api/generated/model";
export const resolutionSchema = z
  .object({
    kind: z.enum(["exclude_supply", "zero_stock", "launch"]),
    provider: z.enum(["wildberries", "ozon"]),
    externalId: z.string(),
    supplyId: z.string(),
    donorProvider: z.enum(["wildberries", "ozon"]),
    note: z
      .string()
      .trim()
      .min(3, "Укажите причину")
      .max(500, "Максимум 500 символов"),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "exclude_supply") {
      if (!value.supplyId || value.provider !== "wildberries")
        ctx.addIssue({
          code: "custom",
          path: ["supplyId"],
          message: "Выберите поставку WB",
        });
    } else if (!value.externalId)
      ctx.addIssue({
        code: "custom",
        path: ["externalId"],
        message: "Выберите товар",
      });
    if (value.kind === "launch" && value.provider === value.donorProvider)
      ctx.addIssue({
        code: "custom",
        path: ["donorProvider"],
        message: "Выберите другую площадку",
      });
  });
export type ResolutionValues = z.infer<typeof resolutionSchema>;
export function resolutionCommand(
  values: ResolutionValues,
): Omit<SetMarketplaceResolutionDto, "requestId"> {
  return {
    kind: values.kind,
    provider: values.provider,
    enabled: true,
    note: values.note.trim(),
    ...(values.kind === "exclude_supply"
      ? { supplyId: values.supplyId }
      : { externalId: values.externalId }),
    ...(values.kind === "launch"
      ? { donorProvider: values.donorProvider }
      : {}),
  };
}
export const resolutionLabels = {
  exclude_supply: "Поставка утрачена — больше не ждём",
  zero_stock: "На площадке пока нет товара",
  launch: "Планировать запуск новинки",
};
