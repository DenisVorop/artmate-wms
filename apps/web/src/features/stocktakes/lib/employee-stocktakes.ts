import type {
  StocktakeDto,
  StocktakeSummaryDto,
} from "@/shared/api/generated/model";
export function employeeStocktakeJobs(
  items: StocktakeSummaryDto[],
  employeeId: string,
) {
  return items
    .filter(
      (d) =>
        (d.employeeId === employeeId &&
          ["counting", "review"].includes(d.status)) ||
        (d.status === "queued" && !d.employeeId),
    )
    .sort((a, b) => {
      const rank = (d: StocktakeSummaryDto) =>
        d.status === "counting" ? 0 : d.status === "review" ? 1 : 2;
      return (
        rank(a) - rank(b) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id)
      );
    });
}
export function lastCountedStocktakeRow(rows: StocktakeDto["rows"]) {
  return rows.reduce<StocktakeDto["rows"][number] | undefined>(
    (last, row) =>
      row.count &&
      row.countedAt &&
      (!last?.countedAt || row.countedAt > last.countedAt)
        ? row
        : last,
    undefined,
  )?.locationId;
}

export function employeeStocktakeNextRow(
  doc: Pick<StocktakeDto, "rows">,
  afterId?: string,
) {
  const rows = doc.rows;
  const lastCounted = afterId ?? lastCountedStocktakeRow(rows);
  const start = lastCounted
    ? Math.max(0, rows.findIndex((r) => r.locationId === lastCounted) + 1)
    : 0;
  const ordered = [...rows.slice(start), ...rows.slice(0, start)];
  return (
    ordered.find((r) => (r.stale || !r.count) && !r.busyReasons.length)
      ?.locationId ??
    ordered.find((r) => r.stale || !r.count)?.locationId ??
    ""
  );
}
export function employeeStocktakeCanLeave(dirtyRows: ReadonlySet<string>) {
  return dirtyRows.size === 0;
}

export function employeeStocktakeSelection(
  doc: Pick<StocktakeDto, "rows">,
  selected: string | null,
) {
  return selected ?? employeeStocktakeNextRow(doc);
}
