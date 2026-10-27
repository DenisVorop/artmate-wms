import type { ForecastChartPointDto } from "@/entities/forecast";
import {
  chartCalendarDay,
  isValidChartRange,
  type ChartRange,
} from "./chart-period";

export function forecastChart(
  points: ForecastChartPointDto[],
  domain?: ChartRange,
  forecastFrom?: string,
) {
  const width = 640,
    height = 220,
    pad = 12,
    datedPoints = points
      .filter((point) => chartCalendarDay(point.date) !== null)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date)),
    max = Math.max(
      1,
      ...datedPoints.flatMap((point) => [
        point.actual ?? 0,
        point.predicted ?? 0,
      ]),
    ),
    validDomain = domain && isValidChartRange(domain) ? domain : null,
    firstDay = validDomain
      ? chartCalendarDay(validDomain.from)!
      : datedPoints.length
        ? chartCalendarDay(datedPoints[0].date)!
        : 0,
    lastDay = validDomain
      ? chartCalendarDay(validDomain.to)!
      : datedPoints.length
        ? chartCalendarDay(datedPoints[datedPoints.length - 1].date)!
        : firstDay,
    xForDate = (date: string) =>
      lastDay === firstDay
        ? width / 2
        : pad +
          ((width - 2 * pad) *
            ((chartCalendarDay(date) ?? firstDay) - firstDay)) /
            Math.max(1, lastDay - firstDay),
    yForValue = (value: number) =>
      height - pad - ((height - 2 * pad) * value) / max,
    geometry = datedPoints.map((point) => ({
      ...point,
      x: xForDate(point.date),
      actualY: point.actual === null ? null : yForValue(point.actual),
      predictedY: point.predicted === null ? null : yForValue(point.predicted),
    }));

  function path(key: "actual" | "predicted") {
    let previousDay: number | null = null;
    return geometry
      .map((point) => {
        const value = point[key],
          day = chartCalendarDay(point.date)!;
        if (value === null) {
          previousDay = null;
          return "";
        }
        const command =
          previousDay !== null && day - previousDay === 1 ? "L" : "M";
        previousDay = day;
        return `${command}${point.x.toFixed(1)},${yForValue(value).toFixed(1)}`;
      })
      .join(" ");
  }
  const firstPrediction = geometry.find((point) => point.predicted !== null);
  return {
    width,
    height,
    pad,
    max,
    actual: path("actual"),
    predicted: path("predicted"),
    hasData: datedPoints.some(
      (point) => point.actual !== null || point.predicted !== null,
    ),
    points: geometry,
    xForDate,
    yForValue,
    ticks: [max, (max * 2) / 3, max / 3, 0].map((value) => ({
      value,
      y: yForValue(value),
    })),
    forecastStartX:
      forecastFrom && chartCalendarDay(forecastFrom) !== null
        ? chartCalendarDay(forecastFrom)! > lastDay
          ? null
          : xForDate(
              forecastFrom <=
                (validDomain?.from ?? datedPoints[0]?.date ?? forecastFrom)
                ? (validDomain?.from ?? datedPoints[0]?.date ?? forecastFrom)
                : forecastFrom,
            )
        : (firstPrediction?.x ?? null),
  };
}

export function chartTotals(points: ForecastChartPointDto[]): {
  actual: number | null;
  predicted: number | null;
  actualDays: number;
  predictedDays: number;
  flatForecast: boolean;
  dailyForecast: number | null;
} {
  const actual = points.flatMap((point) =>
      point.actual === null ? [] : [point.actual],
    ),
    predicted = points.flatMap((point) =>
      point.predicted === null ? [] : [point.predicted],
    ),
    predictedTotal = predicted.length
      ? predicted.reduce((sum, value) => sum + value, 0)
      : null;
  return {
    actual: actual.length
      ? actual.reduce((sum, value) => sum + value, 0)
      : null,
    predicted: predictedTotal,
    actualDays: actual.length,
    predictedDays: predicted.length,
    flatForecast:
      predicted.length >= 2 &&
      predicted.every(
        (value) =>
          Math.abs(value - predicted[0]) <=
          Math.max(1, Math.abs(value), Math.abs(predicted[0])) * 1e-9,
      ),
    dailyForecast:
      predictedTotal === null ? null : predictedTotal / predicted.length,
  };
}

export function shortDate(date: string | null) {
  return date
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/Moscow",
      }).format(new Date(`${date}T12:00:00+03:00`))
    : "Пока нет данных";
}
