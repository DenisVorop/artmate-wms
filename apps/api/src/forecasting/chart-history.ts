import type {
  ForecastChartPointDto,
  ForecastOverviewDto,
} from "./forecast-dto";
import type { ForecastCache } from "./forecast-storage";
import type { ForecastHistorySeries } from "./history-types";

/** Derived lookup of a genuinely prospective publication, not a newly fitted historical value. */
export interface ForecastSavedChartPoint {
  historyKey: string;
  date: string;
  units: number;
  publishedAt: string;
}

const moscowDay = (timestamp: string) =>
  new Date(Date.parse(timestamp) + 10_800_000).toISOString().slice(0, 10);

/** Adds saved predictions to the existing chart. Facts, the current fit, and immutable cache are unchanged. */
export function overlayForecastChartHistory(
  cache: ForecastCache,
  saved: ForecastSavedChartPoint[],
  activeScopeKeys: string[],
  asOf: string,
  history?: ForecastHistorySeries[],
): ForecastOverviewDto {
  const active = new Set(activeScopeKeys);
  const identities = (cache.chartIdentities ?? []).filter((identity) =>
    active.has(identity.scopeKey),
  );
  const allowed = new Set(identities.map((identity) => identity.historyKey));
  const selected = new Map<string, ForecastSavedChartPoint>();
  for (const point of saved) {
    if (
      !allowed.has(point.historyKey) ||
      !Number.isFinite(point.units) ||
      point.units < 0 ||
      !Number.isFinite(Date.parse(point.publishedAt)) ||
      point.date > asOf ||
      moscowDay(point.publishedAt) >= point.date
    )
      continue;
    const key = JSON.stringify([point.historyKey, point.date]);
    const prior = selected.get(key);
    if (!prior || Date.parse(point.publishedAt) > Date.parse(prior.publishedAt))
      selected.set(key, point);
  }
  return {
    ...cache.overview,
    rows: cache.overview.rows.map((row) => ({
      ...row,
      sources: row.sources.map((source, sourceIndex) => {
        const identity = identities.find(
          (item) =>
            item.skuId === row.skuId && item.sourceIndex === sourceIndex,
        );
        if (
          !identity ||
          !source.forecastFrom ||
          source.provider !== identity.provider
        )
          return source;
        const points = new Map<string, ForecastChartPointDto>(
          source.points.map((point) => [point.date, { ...point }]),
        );
        if (history) {
          const matching = history.filter(
            (series) =>
              series.skuId === identity.skuId &&
              series.provider === identity.provider &&
              series.storeId === identity.storeId &&
              series.externalId === identity.externalId,
          );
          const primary = matching.filter(
            (series) =>
              series.metric ===
              (identity.metric === "net_ordered" ? "ordered" : identity.metric),
          );
          const cancelled = matching.filter(
            (series) => series.metric === "cancelled",
          );
          const first = new Map(
            primary.length === 1
              ? primary[0].points.map((point) => [point.date, point.units])
              : [],
          );
          const second = new Map(
            cancelled.length === 1
              ? cancelled[0].points.map((point) => [point.date, point.units])
              : [],
          );
          const dates = new Set([
            ...points.keys(),
            ...first.keys(),
            ...(identity.metric === "net_ordered" ? second.keys() : []),
          ]);
          for (const date of dates) {
            if (date > asOf) continue;
            const value = first.get(date),
              cancel = second.get(date);
            const actual =
              value == null ||
              (identity.metric === "net_ordered" && cancel == null)
                ? null
                : identity.metric === "net_ordered"
                  ? Math.max(0, value - cancel!)
                  : value;
            const current = points.get(date);
            points.set(date, {
              ...current,
              date,
              actual,
              predicted: current?.predicted ?? null,
            });
          }
        }
        for (const point of selected.values()) {
          if (
            point.historyKey !== identity.historyKey ||
            point.date >= source.forecastFrom
          )
            continue;
          const current = points.get(point.date);
          points.set(point.date, {
            date: point.date,
            actual: current?.actual ?? null,
            predicted: point.units,
            predictedAt: point.publishedAt,
          });
        }
        return {
          ...source,
          points: [...points.values()].sort((a, b) =>
            a.date.localeCompare(b.date),
          ),
        };
      }),
    })),
  };
}
