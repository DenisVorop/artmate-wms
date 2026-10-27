import type { ForecastChartPointDto } from "@/entities/forecast";
export function chartActualValue(
  point: ForecastChartPointDto,
  forecastFrom?: string,
) {
  if (point.actual !== null)
    return `${point.actual.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} шт.`;
  if (forecastFrom && point.date > forecastFrom) return "Будущая дата";
  if (forecastFrom && point.date === forecastFrom) return "День ещё идёт";
  return "Нет данных";
}
