import { z } from "zod";
import type {
  StocktakeRowDto,
  CountStocktakeLocationDto,
} from "@/shared/api/generated/model";
const code = z
  .string()
  .trim()
  .min(1, "Введите код")
  .max(150, "Код не длиннее 150 символов");
const validQuantity = (value: string) =>
  /^\d+$/.test(value) &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) <= 100000000;
export const stocktakeCountSchema = z
  .object({
    locationCode: code,
    rawPallets: z
      .array(
        z.object({
          palletCode: code,
          quantity: z.string().trim(),
          present: z.boolean(),
        }),
      )
      .max(200, "Не больше 200 паллет в ячейке"),
    boxCodes: z.array(code).max(2000, "Не больше 2000 коробов в ячейке"),
    inspected: z
      .boolean()
      .refine(
        (value) => value,
        "Подтвердите, что осмотрели и пересчитали ячейку",
      ),
  })
  .superRefine((values, ctx) => {
    const raw = new Set<string>(),
      boxes = new Set<string>();
    values.rawPallets.forEach((row, index) => {
      if (!row.present) return;
      if (!validQuantity(row.quantity))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rawPallets", index, "quantity"],
          message:
            "Укажите целое количество от 0 до 100 000 000; пустое поле не означает 0",
        });
      const key = row.palletCode.toLowerCase();
      if (raw.has(key))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rawPallets", index, "palletCode"],
          message: "Эта паллета уже указана",
        });
      raw.add(key);
    });
    values.boxCodes.forEach((value, index) => {
      const key = value.toLowerCase();
      if (boxes.has(key))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["boxCodes", index],
          message: "Этот короб уже указан",
        });
      boxes.add(key);
    });
  });
export type StocktakeCountValues = z.infer<typeof stocktakeCountSchema>;
export function pendingCountBoxError(input: string): string | null {
  return input.trim()
    ? "Добавьте введённый код короба в список или очистите поле перед сохранением"
    : null;
}
export function stocktakeCountDefaults(
  row: StocktakeRowDto,
  compact = false,
): StocktakeCountValues {
  const known = row.baseline.rawPallets.map((pallet) => {
    const actual = row.count?.rawPallets.find(
      (item) =>
        item.palletCode.toLowerCase() === pallet.palletCode.toLowerCase(),
    );
    return {
      palletCode: pallet.palletCode,
      quantity: actual?.quantity.toString() ?? "",
      present: !!actual,
    };
  });
  const extras = (row.count?.rawPallets ?? [])
    .filter(
      (item) =>
        !known.some(
          (pallet) =>
            pallet.palletCode.toLowerCase() === item.palletCode.toLowerCase(),
        ),
    )
    .map((item) => ({
      palletCode: item.palletCode,
      quantity: String(item.quantity),
      present: true,
    }));
  return {
    locationCode: "",
    rawPallets: compact
      ? (row.count?.rawPallets ?? []).map((pallet) => ({
          palletCode: pallet.palletCode,
          quantity: String(pallet.quantity),
          present: true,
        }))
      : [...known, ...extras],
    boxCodes: row.count?.boxCodes ?? [],
    inspected: false,
  };
}
export function toStocktakeCount(
  values: StocktakeCountValues,
): Omit<CountStocktakeLocationDto, "requestId" | "expectedRevision"> {
  const parsed = stocktakeCountSchema.parse(values);
  return {
    locationCode: parsed.locationCode,
    rawPallets: parsed.rawPallets
      .filter((row) => row.present)
      .map((row) => ({
        palletCode: row.palletCode,
        quantity: Number(row.quantity),
      })),
    boxCodes: parsed.boxCodes,
  };
}
export function addCountBox(
  codes: string[],
  input: string,
): { codes: string[]; error: string | null } {
  const parsed = code.safeParse(input);
  if (!parsed.success)
    return {
      codes,
      error: parsed.error.issues[0]?.message ?? "Введите код короба",
    };
  if (codes.some((value) => value.toLowerCase() === parsed.data.toLowerCase()))
    return { codes, error: "Этот короб уже отмечен найденным" };
  return { codes: [...codes, parsed.data], error: null };
}
