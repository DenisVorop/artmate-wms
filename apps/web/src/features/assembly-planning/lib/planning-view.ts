import type { MarketplacePlanRowDto } from "@/entities/assembly-plan";
export type PlanningFilter = "assembly" | "review" | "all";
export function boxesLabel(count: number) {
  const last = count % 10,
    tail = count % 100;
  const word =
    tail >= 11 && tail <= 14
      ? "коробов"
      : last === 1
        ? "короб"
        : last >= 2 && last <= 4
          ? "короба"
          : "коробов";
  return `${new Intl.NumberFormat("ru-RU").format(count)} ${word}`;
}
export function planningGroups(rows: MarketplacePlanRowDto[]) {
  const assembly = rows.filter(
    (row) =>
      row.dataComplete && ["ready", "raw_shortage"].includes(row.advice.state),
  );
  const review = rows.filter((row) => row.advice.state === "review");
  return {
    assembly,
    review,
    covered: rows.filter((row) => row.advice.state === "covered"),
    boxes: assembly.reduce((sum, row) => sum + row.recommendedBoxes, 0),
  };
}
export function planningRows(
  rows: MarketplacePlanRowDto[],
  filter: PlanningFilter,
) {
  const groups = planningGroups(rows);
  const selected =
    filter === "assembly"
      ? groups.assembly
      : filter === "review"
        ? groups.review
        : rows;
  const priority = { ready: 0, raw_shortage: 1, review: 2, covered: 3 };
  return [...selected].sort(
    (a, b) =>
      priority[a.advice.state] - priority[b.advice.state] ||
      b.recommendedBoxes - a.recommendedBoxes ||
      a.skuName.localeCompare(b.skuName, "ru"),
  );
}
