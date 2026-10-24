import { z } from "zod";
import {
  StockLedgerEventDtoKind,
  type GetStockLedgerParams,
} from "@/shared/api/generated/model";
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
const date = z
  .string()
  .refine((value) => !value || validDate(value), "Укажите корректную дату");
export const ledgerFilterSchema = z
  .object({
    kind: z.union([z.nativeEnum(StockLedgerEventDtoKind), z.literal("")]),
    skuId: z.string().trim(),
    employeeId: z.string().trim(),
    from: date,
    to: date,
    search: z.string().trim().max(200, "Не больше 200 символов"),
    pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  })
  .superRefine((values, ctx) => {
    if (values.from && values.to && values.from > values.to)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "Дата окончания должна быть не раньше начала",
      });
  });
export type LedgerFilterValues = z.infer<typeof ledgerFilterSchema>;
export function ledgerFilterDefaults(): LedgerFilterValues {
  return {
    kind: "",
    skuId: "",
    employeeId: "",
    from: "",
    to: "",
    search: "",
    pageSize: 25,
  };
}
export function ledgerQuery(
  values: LedgerFilterValues,
  page: number,
): GetStockLedgerParams {
  return {
    page,
    pageSize: values.pageSize,
    ...(values.kind ? { kind: values.kind } : {}),
    ...(values.skuId ? { skuId: values.skuId } : {}),
    ...(values.employeeId ? { employeeId: values.employeeId } : {}),
    ...(values.search.trim() ? { search: values.search.trim() } : {}),
    ...(values.from
      ? { from: new Date(`${values.from}T00:00:00.000+03:00`).toISOString() }
      : {}),
    ...(values.to
      ? { to: new Date(`${values.to}T23:59:59.999+03:00`).toISOString() }
      : {}),
  };
}
export function ledgerPageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
export function ledgerResultRange(
  page: number,
  pageSize: number,
  total: number,
): { from: number; to: number } {
  if (total === 0 || (page - 1) * pageSize >= total) return { from: 0, to: 0 };
  return {
    from: Math.min((page - 1) * pageSize + 1, total),
    to: Math.min(page * pageSize, total),
  };
}
