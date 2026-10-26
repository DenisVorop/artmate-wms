import type { ForecastChartPointDto } from "@/entities/forecast";
export function forecastChart(points: ForecastChartPointDto[]) {
  const width = 640,
    height = 200,
    pad = 12,
    max = Math.max(
      1,
      ...points.flatMap((p) => [p.actual ?? 0, p.predicted ?? 0]),
    );
  const x = (i: number) =>
      pad + ((width - 2 * pad) * i) / Math.max(1, points.length - 1),
    y = (n: number) => height - pad - ((height - 2 * pad) * n) / max;
  function path(key: "actual" | "predicted") {
    let connected = false;
    return points
      .map((p, i) => {
        const n = p[key];
        if (n === null) {
          connected = false;
          return "";
        }
        const command = connected ? "L" : "M";
        connected = true;
        return `${command}${x(i).toFixed(1)},${y(n).toFixed(1)}`;
      })
      .join(" ");
  }
  return {
    width,
    height,
    max,
    actual: path("actual"),
    predicted: path("predicted"),
    hasData: points.some((p) => p.actual !== null || p.predicted !== null),
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
