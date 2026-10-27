import type {
  ForecastJournalComparedRowDto,
  ForecastSourceDto,
} from "@/entities/forecast";
export const journalDate = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export const journalQuantity = (value: number, digits = 1) =>
  value.toLocaleString("ru-RU", { maximumFractionDigits: digits });
export function journalChart(
  row: ForecastJournalComparedRowDto,
): ForecastSourceDto {
  return {
    provider: row.provider,
    metricLabel: "Сохранённый прогноз заказов за вычетом отмен",
    modelLabel: row.modelLabel,
    predictedUnits: row.points.reduce((n, p) => n + p.predicted, 0),
    historyDays: row.scoredDays,
    candidates: [],
    points: row.points.map((point) => ({
      date: point.date,
      predicted: point.predicted,
      actual: point.actual,
    })),
  };
}
export const journalStatus = (status: string) =>
  ({
    pending: "Ожидаем продажи",
    unknown: "Нет данных",
    stockout: "Товара не было в наличии",
    same_day: "День публикации · вне оценки",
    scored: "Учтено в оценке",
  })[status] ?? "Нет данных";
