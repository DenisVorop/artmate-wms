import type {
  StocktakeDto,
  StocktakeRowDto,
  StocktakePreviewDto,
} from "@/shared/api/generated/model";

export function stocktakePreviewPresentation(
  doc: {
    status: StocktakeDto["status"];
    rows: Pick<StocktakeRowDto, "count">[];
  },
  preview: StocktakePreviewDto,
) {
  const showChanges =
    doc.status === "approved" ||
    (doc.rows.length > 0 && doc.rows.every((row) => row.count != null));
  return {
    showChanges,
    changes: showChanges ? preview.changes : [],
    unitsDelta: showChanges ? preview.unitsDelta : null,
    issues: preview.issues,
  };
}

export function stocktakeCancelDescription(dirtyRows: number): string {
  return `Документ перейдёт в архив. Сохранённый подсчёт и его история сохранятся, товарный остаток не изменится. Продолжить этот документ после отмены нельзя.${dirtyRows > 0 ? ` Несохранённый локальный ввод будет потерян. Ячеек с несохранённым вводом: ${dirtyRows}.` : ""}`;
}

export function stocktakeStatus(status: string): string {
  return (
    (
      {
        queued: "Свободен",
        counting: "Подсчёт",
        review: "На проверке",
        approved: "Утверждён",
        cancelled: "Отменён",
      } as Record<string, string>
    )[status] ?? status
  );
}
export function stocktakeDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}
export function isArchivedStocktake(status: string): boolean {
  return status === "approved" || status === "cancelled";
}
export function stocktakePages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
export function newestStocktake<T extends { id: string; revision: number }>(
  response: T,
  cached: T | undefined,
): T {
  return cached?.id === response.id && cached.revision > response.revision
    ? cached
    : response;
}
