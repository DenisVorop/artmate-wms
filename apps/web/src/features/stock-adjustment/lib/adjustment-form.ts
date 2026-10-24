import { z } from "zod";
import {
  AdjustStockDtoKind,
  type AdjustStockDto,
} from "@/shared/api/generated/model";
import type { AdjustmentSnapshot } from "./adjustment-targets";

export const adjustmentSchema = z.object({
  kind: z.nativeEnum(AdjustStockDtoKind),
  targetId: z.string().min(1, "Выберите объект корректировки"),
  employeeId: z.string().min(1, "Выберите сотрудника на смене"),
  countedQuantity: z
    .number({ invalid_type_error: "Укажите фактическое количество" })
    .finite("Укажите конечное число")
    .int("Нужно целое число")
    .min(0, "Количество не может быть отрицательным")
    .max(100000000, "Не больше 100 000 000 штук"),
  reason: z
    .string()
    .trim()
    .min(5, "Опишите причину: минимум 5 символов")
    .max(500, "Не больше 500 символов"),
});
export type AdjustmentValues = z.infer<typeof adjustmentSchema>;
export function adjustmentSchemaFor(snapshot: AdjustmentSnapshot | null) {
  return adjustmentSchema.superRefine((values, ctx) => {
    if (values.kind === "box_writeoff" && values.countedQuantity !== 0)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["countedQuantity"],
        message: "Короб списывается целиком: остаток после списания — 0",
      });
    if (
      values.kind === "raw_count" &&
      snapshot?.targetId === values.targetId &&
      values.countedQuantity === snapshot.expectedQuantity
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["countedQuantity"],
        message:
          "Фактическое количество совпадает с учтённым: корректировка не нужна",
      });
  });
}
export const adjustmentDefaults: AdjustmentValues = {
  kind: AdjustStockDtoKind.raw_count,
  targetId: "",
  employeeId: "",
  countedQuantity: 0,
  reason: "",
};
export function toStockAdjustment(
  values: AdjustmentValues,
  snapshot: AdjustmentSnapshot,
  requestId = crypto.randomUUID(),
  employeeId = values.employeeId,
): AdjustStockDto {
  if (values.kind !== snapshot.kind || values.targetId !== snapshot.targetId)
    throw new Error("Повторно выберите объект корректировки");
  const parsed = adjustmentSchemaFor(snapshot).parse({ ...values, employeeId });
  return {
    requestId,
    kind: parsed.kind,
    targetId: parsed.targetId,
    employeeId: parsed.employeeId,
    expectedLocationId: snapshot.expectedLocationId,
    expectedQuantity: snapshot.expectedQuantity,
    countedQuantity:
      parsed.kind === "box_writeoff" ? 0 : parsed.countedQuantity,
    reason: parsed.reason,
  };
}
