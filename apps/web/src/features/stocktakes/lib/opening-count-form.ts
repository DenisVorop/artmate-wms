import { z } from "zod";
import type {
  CountStocktakeLocationDto,
  StocktakeRowDto,
} from "@/shared/api/generated/model";

const dateValue = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const integer = (value: string, max: number) =>
  /^\d+$/.test(value) &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) >= 1 &&
  Number(value) <= max;
export const openingToday = (now = new Date()) =>
  new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10);
export function openingCountSchema(today = openingToday()) {
  return z
    .object({
      locationCode: z
        .string()
        .trim()
        .min(1, "Сканируйте или введите код адреса")
        .max(150),
      observed: z.enum(["", "empty", "pallet"]),
      kind: z.enum(["raw", "finished"]),
      skuId: z.string(),
      batches: z
        .array(
          z.object({ receivedOn: z.string(), quantity: z.string().trim() }),
        )
        .max(2000),
      unitsPerBox: z.string().trim(),
      heightCm: z.string().trim(),
      weightKg: z.string().trim(),
      inspected: z
        .boolean()
        .refine(Boolean, "Подтвердите, что осмотрели и пересчитали адрес"),
    })
    .superRefine((v, ctx) => {
      const problem = (path: (string | number)[], message: string) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
      if (!v.observed)
        problem(
          ["observed"],
          "Выберите: адрес пустой или на нём стоит паллета",
        );
      if (v.observed !== "pallet") return;
      if (!v.skuId) problem(["skuId"], "Выберите тематику или товар");
      if (!v.batches.length || (v.kind === "raw" && v.batches.length !== 1))
        problem(["batches"], "Для сырья укажите одну дату поступления");
      v.batches.forEach((b, i) => {
        if (!dateValue(b.receivedOn) || b.receivedOn > today)
          problem(
            ["batches", i, "receivedOn"],
            "Укажите известную дату поступления не позднее сегодняшнего дня",
          );
        if (!integer(b.quantity, v.kind === "raw" ? 100000000 : 2000))
          problem(
            ["batches", i, "quantity"],
            v.kind === "raw"
              ? "Укажите целое количество от 1 до 100 000 000 шт."
              : "Укажите целое количество от 1 до 2000 коробов",
          );
      });

      if (
        v.kind === "finished" &&
        v.batches.reduce(
          (sum, batch) => sum + (Number(batch.quantity) || 0),
          0,
        ) > 2000
      )
        problem(
          ["batches"],
          "На одном адресе можно внести не больше 2000 готовых коробов",
        );
      if (
        v.kind === "raw" &&
        (!/^\d+(\.\d)?$/.test(v.heightCm) ||
          Number(v.heightCm) < 15 ||
          Number(v.heightCm) > 1000)
      )
        problem(["heightCm"], "Укажите полную высоту с поддоном в сантиметрах");
      if (v.kind === "finished" && !integer(v.unitsPerBox, 1000))
        problem(
          ["unitsPerBox"],
          "Укажите целое количество товара в одном коробе",
        );
      if (
        v.kind === "raw" &&
        v.weightKg &&
        (!Number.isFinite(Number(v.weightKg)) ||
          Number(v.weightKg) <= 0 ||
          Number(v.weightKg) > 100000)
      )
        problem(
          ["weightKg"],
          "Укажите положительную массу паллеты в килограммах",
        );
    });
}
export type OpeningCountValues = z.infer<ReturnType<typeof openingCountSchema>>;
export function openingCountDefaults(
  row: Pick<StocktakeRowDto, "count">,
): OpeningCountValues {
  const counted = row.count?.openingPallet;
  return {
    locationCode: "",
    observed: counted
      ? "pallet"
      : row.count?.openingPallet === null
        ? "empty"
        : "",
    kind: counted?.kind ?? "raw",
    skuId: counted?.skuId ?? "",
    batches: counted?.batches.map((b) => ({
      receivedOn: new Date(Date.parse(b.receivedAt) + 3 * 3600000)
        .toISOString()
        .slice(0, 10),
      quantity: String(b.quantity),
    })) ?? [{ receivedOn: "", quantity: "" }],
    unitsPerBox: counted?.unitsPerBox?.toString() ?? "",
    heightCm: counted?.heightMm ? String(counted.heightMm / 10) : "",
    weightKg: counted?.weightKg?.toString() ?? "",
    inspected: false,
  };
}
export function toOpeningCount(
  v: OpeningCountValues,
  today = openingToday(),
): Omit<CountStocktakeLocationDto, "requestId" | "expectedRevision"> {
  const parsed = openingCountSchema(today).parse(v);
  return {
    locationCode: parsed.locationCode,
    rawPallets: [],
    boxCodes: [],
    openingPallet:
      parsed.observed === "empty"
        ? null
        : {
            kind: parsed.kind,
            skuId: parsed.skuId,
            batches: parsed.batches.map((b) => ({
              receivedAt: new Date(
                `${b.receivedOn}T00:00:00+03:00`,
              ).toISOString(),
              quantity: Number(b.quantity),
            })),
            ...(parsed.kind === "raw"
              ? {
                  heightMm: Math.round(Number(parsed.heightCm) * 10),
                  weightKg: parsed.weightKg ? Number(parsed.weightKg) : null,
                }
              : { unitsPerBox: Number(parsed.unitsPerBox) }),
          },
  };
}
