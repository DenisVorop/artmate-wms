import type { Queryable } from "../database";
import type { ForecastJournalRun } from "./journal-types";
import type { ForecastSavedChartPoint } from "./chart-history";
export async function initializeForecastChartStorage(tx: Queryable) {
  await tx.query(
    "CREATE TABLE IF NOT EXISTS forecast_chart_days(history_key TEXT NOT NULL,target_date DATE NOT NULL,published_at TIMESTAMPTZ NOT NULL,payload JSONB NOT NULL,PRIMARY KEY(history_key,target_date))",
  );
}
/** Compact read projection. Full immutable forecast vintages remain in forecast_journal. */
export async function appendForecastChartDays(
  tx: Queryable,
  run: ForecastJournalRun,
) {
  if (!Number.isFinite(Date.parse(run.publishedAt)))
    throw new Error("Invalid forecast publication time");
  const day = new Date(Date.parse(run.publishedAt) + 10_800_000)
    .toISOString()
    .slice(0, 10);
  const unique = new Map<string, ForecastSavedChartPoint>();
  for (const chart of run.charts ?? [])
    for (const point of chart.points) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(point.date) ||
        !Number.isFinite(Date.parse(point.date)) ||
        new Date(point.date).toISOString().slice(0, 10) !== point.date ||
        !Number.isFinite(point.units) ||
        point.units < 0
      )
        throw new Error("Invalid saved chart point");
      if (point.date <= day) continue;
      const key = JSON.stringify([chart.historyKey, point.date]);
      const previous = unique.get(key);
      if (previous && previous.units !== point.units)
        throw new Error("Conflicting saved chart identity");
      unique.set(key, {
        historyKey: chart.historyKey,
        date: point.date,
        units: point.units,
        publishedAt: run.publishedAt,
      });
    }
  if (!unique.size) return;
  await tx.query(
    `INSERT INTO forecast_chart_days(history_key,target_date,published_at,payload)
    SELECT item->>'historyKey',(item->>'date')::date,(item->>'publishedAt')::timestamptz,item FROM jsonb_array_elements($1::jsonb) item
    WHERE (item->>'publishedAt')::timestamptz < (item->>'date')::date AT TIME ZONE 'Europe/Moscow'
    ON CONFLICT(history_key,target_date) DO UPDATE SET published_at=EXCLUDED.published_at,payload=EXCLUDED.payload
    WHERE forecast_chart_days.published_at<EXCLUDED.published_at`,
    [JSON.stringify([...unique.values()])],
  );
}
export async function readForecastChartDays(
  tx: Queryable,
  historyKeys: string[],
  asOf: string,
): Promise<ForecastSavedChartPoint[]> {
  if (!historyKeys.length) return [];
  return (
    await tx.query<{ payload: ForecastSavedChartPoint }>(
      "SELECT payload FROM forecast_chart_days WHERE history_key=ANY($1::text[]) AND target_date<=$2::date ORDER BY target_date,history_key",
      [historyKeys, asOf],
    )
  ).rows.map((row) => row.payload);
}
