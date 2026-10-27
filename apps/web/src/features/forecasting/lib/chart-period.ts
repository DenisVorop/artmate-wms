import type {
  ForecastChartPointDto,
  ForecastSourceDto,
} from "@/entities/forecast";

export type ChartRange = { from: string; to: string };
export type ChartPeriod = "month" | "quarter" | "year" | "all" | "custom";

const DAY_MS = 86_400_000;

/** UTC is used only for arithmetic on calendar dates, independent of browser TZ. */
export function chartCalendarDay(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === date
    ? timestamp / DAY_MS
    : null;
}

function dateForDay(day: number) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function isValidChartRange(range: ChartRange): boolean {
  const from = chartCalendarDay(range.from),
    to = chartCalendarDay(range.to);
  return from !== null && to !== null && from <= to;
}

export function chartRangeBounds(
  sources: Pick<ForecastSourceDto, "points" | "forecastFrom">[],
): { first: string; last: string; anchor: string } {
  const points = sources.flatMap((source) => source.points),
    dates = points
      .map((point) => chartCalendarDay(point.date))
      .filter((day): day is number => day !== null);
  if (!dates.length) return { first: "", last: "", anchor: "" };
  const first = Math.min(...dates),
    last = Math.max(...dates),
    predictedDates = points
      .filter((point) => point.predicted !== null)
      .map((point) => chartCalendarDay(point.date))
      .filter((day): day is number => day !== null),
    actualDates = points
      .filter((point) => point.actual !== null)
      .map((point) => chartCalendarDay(point.date))
      .filter((day): day is number => day !== null),
    forecastStarts = sources
      .map((source) =>
        source.forecastFrom ? chartCalendarDay(source.forecastFrom) : null,
      )
      .filter((day): day is number => day !== null),
    anchor = forecastStarts.length
      ? Math.max(...forecastStarts) - 1
      : predictedDates.length
        ? Math.min(...predictedDates) - 1
        : actualDates.length
          ? Math.max(...actualDates)
          : first;
  return {
    first: dateForDay(first),
    last: dateForDay(last),
    anchor: dateForDay(anchor),
  };
}

export function presetChartRange(
  sources: Pick<ForecastSourceDto, "points" | "forecastFrom">[],
  period: Exclude<ChartPeriod, "custom">,
): ChartRange {
  const bounds = chartRangeBounds(sources);
  if (!bounds.first) return { from: "", to: "" };
  if (period === "all") return { from: bounds.first, to: bounds.last };
  const anchor = chartCalendarDay(bounds.anchor)!,
    first = chartCalendarDay(bounds.first)!,
    last = chartCalendarDay(bounds.last)!,
    historyDays = { month: 30, quarter: 90, year: 365 }[period],
    clamp = (day: number) => Math.max(first, Math.min(last, day));
  return {
    from: dateForDay(clamp(anchor - historyDays + 1)),
    to: dateForDay(clamp(anchor + 30)),
  };
}

/** Inclusive calendar bounds; an invalid user range must not widen the selection. */
export function filterChartPoints(
  points: ForecastChartPointDto[],
  range: ChartRange,
): ForecastChartPointDto[] {
  if (!isValidChartRange(range)) return [];
  return points.filter(
    (point) =>
      chartCalendarDay(point.date) !== null &&
      point.date >= range.from &&
      point.date <= range.to,
  );
}
