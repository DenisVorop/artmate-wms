import { z } from "zod";
import type {
  CreateReceiptDto,
  CreateReceiptPalletDto,
} from "@/shared/api/generated/model";

export function moscowDateTimeInput(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (name: string) =>
    parts.find((item) => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function receiptDateToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+03:00`);
  return Number.isFinite(date.getTime()) && moscowDateTimeInput(date) === value
    ? date.toISOString()
    : null;
}
const dimension = z
  .number({ invalid_type_error: "Укажите размер" })
  .finite()
  .min(10, "Минимум 10 см")
  .max(1000, "Максимум 1000 см")
  .refine(
    (value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-7,
    "Укажите размер с точностью до 0,1 см",
  );
export const newSkuSchema = z.object({
  name: z.string().trim().min(1, "Укажите тематику").max(100),
  barcode: z.string().trim().min(1, "Укажите штрихкод").max(150),
  code: z.string().trim().max(40),
  unitsPerBox: z
    .number({ invalid_type_error: "Укажите количество" })
    .int()
    .min(1)
    .max(1000),
});
export type NewSkuValues = z.infer<typeof newSkuSchema>;
export const receiptPalletSchema = z
  .object({
    skuMode: z.enum(["existing", "new"]),
    skuId: z.string(),
    // Hidden new-SKU fields are validated only when that mode is selected.
    newSku: z.custom<NewSkuValues>(),
    quantity: z
      .number({ invalid_type_error: "Укажите количество" })
      .int("Нужно целое количество")
      .min(1, "Минимум 1 раскраска")
      .max(100000),
    widthCm: dimension,
    depthCm: dimension,
    heightCm: dimension,
    weightKg: z
      .number({ invalid_type_error: "Укажите массу или оставьте поле пустым" })
      .finite()
      .positive("Масса должна быть больше нуля")
      .nullable(),
  })
  .superRefine((row, ctx) => {
    if (row.skuMode === "existing" && !row.skuId.trim())
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["skuId"],
        message: "Выберите тематику",
      });
    if (row.skuMode === "new") {
      const result = newSkuSchema.safeParse(row.newSku);
      if (!result.success)
        for (const issue of result.error.issues)
          ctx.addIssue({ ...issue, path: ["newSku", ...issue.path] });
    }
  });
export type ReceiptPalletValues = z.infer<typeof receiptPalletSchema>;
export const receiptSchema = z.object({
  receivedAt: z.string().superRefine((value, ctx) => {
    const iso = receiptDateToIso(value);
    if (!iso)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Укажите корректную дату и время",
      });
    else if (new Date(iso).getTime() > Date.now() + 5 * 60_000)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Дата поступления не может быть в будущем",
      });
  }),
  pallets: z
    .array(receiptPalletSchema)
    .min(1)
    .max(100, "Не больше 100 паллет в документе"),
});
export type ReceiptValues = z.infer<typeof receiptSchema>;
export function palletDefaults(hasSkus: boolean): ReceiptPalletValues {
  return {
    skuMode: hasSkus ? "existing" : "new",
    skuId: "",
    newSku: { name: "", barcode: "", code: "", unitsPerBox: 20 },
    quantity: 1000,
    widthCm: 120,
    depthCm: 80,
    heightCm: 140,
    weightKg: null,
  };
}
export function receiptDefaults(
  hasSkus: boolean,
  now = new Date(),
): ReceiptValues {
  return {
    receivedAt: moscowDateTimeInput(now),
    pallets: [palletDefaults(hasSkus)],
  };
}
export function unknownMass(value: unknown): number | null {
  return value === null ||
    value === undefined ||
    (typeof value === "string" && !value.trim())
    ? null
    : Number(value);
}
export function buildReceipt(values: ReceiptValues): CreateReceiptDto {
  const receivedAt = receiptDateToIso(values.receivedAt);
  if (!receivedAt) throw new Error("Укажите корректную дату поступления");
  const pallets: CreateReceiptPalletDto[] = values.pallets.map((row) => ({
    quantity: row.quantity,
    widthMm: Math.round(row.widthCm * 10),
    depthMm: Math.round(row.depthCm * 10),
    heightMm: Math.round(row.heightCm * 10),
    weightKg: row.weightKg,
    ...(row.skuMode === "existing"
      ? { skuId: row.skuId.trim() }
      : {
          newSku: {
            name: row.newSku.name.trim(),
            barcode: row.newSku.barcode.trim(),
            unitsPerBox: row.newSku.unitsPerBox,
            ...(row.newSku.code.trim() ? { code: row.newSku.code.trim() } : {}),
          },
        }),
  }));
  return { requestId: crypto.randomUUID(), receivedAt, pallets };
}
export const placementSchema = z.object({
  employeeId: z.string().min(1, "Выберите сотрудника на смене"),
  palletCode: z.string().trim().min(1, "Отсканируйте код паллеты"),
  locationCode: z.string().trim().min(1, "Отсканируйте код адреса"),
});
export type PlacementValues = z.infer<typeof placementSchema>;
