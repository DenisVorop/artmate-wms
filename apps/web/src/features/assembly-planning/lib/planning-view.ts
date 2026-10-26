import type { MarketplacePlanRowDto } from "@/entities/assembly-plan";
export type PlanningFilter = "assembly" | "shipping" | "review" | "all";
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
export function packagedLabel(units: number, unitsPerBox: number) {
  const boxes = Math.floor(units / unitsPerBox),
    rest = units % unitsPerBox;
  return rest ? `${boxesLabel(boxes)} + ${rest} шт.` : boxesLabel(boxes);
}
export function dispatchLabel(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Moscow",
  }).format(new Date(`${date}T12:00:00+03:00`));
}
export function planningGroups(rows: MarketplacePlanRowDto[]) {
  const assembly = rows.filter(
    (row) =>
      row.dataComplete && ["ready", "raw_shortage"].includes(row.advice.state),
  );
  const review = rows.filter((row) => row.advice.state === "review");
  const complete = rows.filter(
    (row) => row.dataComplete && row.advice.state !== "review",
  );
  return {
    assembly,
    completeCount: complete.length,
    shipping: complete.filter((row) => row.outboundBoxes > 0),
    outboundBoxes: complete.reduce((sum, row) => sum + row.outboundBoxes, 0),
    remainingBoxes: complete.reduce(
      (sum, row) =>
        sum + Math.floor(row.localAfterDispatchUnits / row.unitsPerBox),
      0,
    ),
    partialBoxes: complete.some(
      (row) => row.localAfterDispatchUnits % row.unitsPerBox > 0,
    ),
    backlog: rows
      .filter((row) => row.backlogRank != null)
      .sort((a, b) => a.backlogRank! - b.backlogRank!),
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
    filter === "shipping"
      ? groups.shipping
      : filter === "assembly"
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
