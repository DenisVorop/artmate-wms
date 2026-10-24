import { isBoxLabelBatchResponse } from "@/shared/api/box-label-response";
import { z } from "zod";
import type { BoxLabelPageDto } from "@/shared/api/generated/model";
export const boxLabelBatchSchema = z.object({
  count: z
    .number({ invalid_type_error: "Введите количество" })
    .int("Нужно целое число")
    .min(1, "Минимум 1 этикетка")
    .max(1000, "Максимум 1000 этикеток"),
});
export type BoxLabelBatchValues = z.infer<typeof boxLabelBatchSchema>;
/** No partial page, duplicates or already assigned labels may reach the printer. */
export function completeFreeLabelPage(
  data: BoxLabelPageDto | undefined,
  id: string | null,
  page: number,
  size: number,
): boolean {
  if (
    !data ||
    !isBoxLabelBatchResponse(data.batch) ||
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
    data.items.every(
      (item) =>
        typeof item.id === "string" &&
        !!item.id.trim() &&
        item.status === "free" &&
        item.taskId === null &&
        item.boxId === null &&
        !!item.code &&
        !!item.svg &&
        item.payload === `artmate-wms:box:${item.code}`,
    )
  );
}
