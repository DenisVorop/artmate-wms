import { isPalletLabelBatchResponse } from "@/shared/api/pallet-label-response";
import { z } from "zod";
import type { PalletLabelPageDto } from "@/shared/api/generated/model";
export const palletLabelBatchSchema = z.object({
  count: z
    .number({ invalid_type_error: "Введите количество" })
    .int("Нужно целое число")
    .min(1, "Минимум 1 этикетка")
    .max(1000, "Максимум 1000 этикеток"),
});
export type PalletLabelBatchValues = z.infer<typeof palletLabelBatchSchema>;
/** No partial page, duplicates or already assigned labels may reach the printer. */
export function completeFreeLabelPage(
  data: PalletLabelPageDto | undefined,
  id: string | null,
  page: number,
  size: number,
): boolean {
  if (
    !data ||
    !isPalletLabelBatchResponse(data.batch) ||
    !Array.isArray(data.items) ||
    data.batch.id !== id ||
    data.page !== page ||
    data.pageSize !== size ||
    !Number.isSafeInteger(data.total) ||
    data.total < 0 ||
    data.total !== data.batch.freeCount
  )
    return false;
  const expected = Math.max(0, Math.min(size, data.total - (page - 1) * size));
  return (
    expected > 0 &&
    data.items.length === expected &&
    new Set(data.items.map((item) => item.id)).size === expected &&
    new Set(data.items.map((item) => item.code)).size === expected &&
    new Set(data.items.map((item) => item.ordinal)).size === expected &&
    data.items.every(
      (item) =>
        typeof item.id === "string" &&
        !!item.id.trim() &&
        Number.isSafeInteger(item.ordinal) &&
        item.ordinal >= 1 &&
        item.ordinal <= data.batch.count &&
        item.status === "free" &&
        item.receiptId === null &&
        item.palletId === null &&
        typeof item.code === "string" &&
        item.code.startsWith("PLT-PRE-") &&
        typeof item.svg === "string" &&
        !!item.svg.trim() &&
        item.payload === `artmate-wms:pallet:${item.code}`,
    )
  );
}
