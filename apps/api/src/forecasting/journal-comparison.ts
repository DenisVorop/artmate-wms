import type { ForecastHistorySeries } from "./history-types";
import type {
  ForecastJournalRun,
  ForecastJournalSeries,
} from "./journal-types";
import type {
  ForecastJournalDetailDto,
  ForecastJournalSummaryDto,
  ForecastJournalComparedRowDto,
} from "./journal-dto";
import { forecastDay } from "./forecast-storage";

export function forecastJournalSummary(
  run: ForecastJournalRun,
): ForecastJournalSummaryDto {
  const dates = run.series.flatMap((s) => s.points.map((p) => p.date)).sort();
  return {
    id: run.id,
    generatedAt: run.generatedAt,
    publishedAt: run.publishedAt,
    asOf: run.asOf,
    modelVersion: run.modelVersion,
    seriesCount: run.series.length,
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
  };
}
export interface JournalActualPoint {
  actual: number | null;
  stockout: boolean;
}
/** History is already expressed in warehouse units by the loader; no second pack multiplication. */
export function journalActualPoints(
  series: ForecastJournalSeries,
  history: ForecastHistorySeries[],
): Map<string, JournalActualPoint> {
  const cards = series.mappings.map((mapping) => {
    const matching = history.filter(
      (s) =>
        s.skuId === series.skuId &&
        s.provider === series.provider &&
        s.storeId === series.storeId &&
        s.externalId === mapping.externalId,
    );
    const ordered = matching.filter((s) => s.metric === "ordered");
    const cancelled = matching.filter((s) => s.metric === "cancelled");
    // Ambiguous duplicate metric sources must not double-count demand.
    return {
      ordered: new Map(
        ordered.length === 1 ? ordered[0].points.map((p) => [p.date, p]) : [],
      ),
      cancelled: new Map(
        cancelled.length === 1
          ? cancelled[0].points.map((p) => [p.date, p])
          : [],
      ),
    };
  });
  return new Map(
    series.points.map((point) => {
      let actual: number | null = cards.length ? 0 : null;
      let stockout = false;
      for (const card of cards) {
        const ordered = card.ordered.get(point.date),
          cancelled = card.cancelled.get(point.date);
        if (
          ordered?.availability === "out_of_stock" ||
          cancelled?.availability === "out_of_stock"
        )
          stockout = true;
        if (ordered?.units == null || cancelled?.units == null) actual = null;
        else if (actual !== null)
          actual += Math.max(0, ordered.units - cancelled.units);
      }
      return [point.date, { actual, stockout }];
    }),
  );
}
/** Compare only genuinely prospective complete days; archived predictions are never edited. */
export function compareForecastJournal(
  run: ForecastJournalRun,
  history: ForecastHistorySeries[],
  asOf: string,
  activeScopeKeys?: string[],
): ForecastJournalDetailDto {
  const active = activeScopeKeys ? new Set(activeScopeKeys) : null;
  const series = run.series.filter((s) => !active || active.has(s.scopeKey));
  const publishedDay = forecastDay(new Date(run.publishedAt));
  const rows: ForecastJournalComparedRowDto[] = series.map((s) => {
    const actuals = journalActualPoints(s, history);
    const points = s.points.map((p) => {
      const observed = actuals.get(p.date)!;
      const actual = p.date <= asOf ? observed.actual : null;
      const status =
        p.date <= publishedDay
          ? ("same_day" as const)
          : p.date > asOf
            ? ("pending" as const)
            : actual === null
              ? ("unknown" as const)
              : observed.stockout
                ? ("stockout" as const)
                : ("scored" as const);
      return {
        date: p.date,
        predicted: p.units,
        basePredicted: p.baseUnits,
        factor: p.factor,
        actual,
        status,
      };
    });
    const scored = points.filter((p) => p.status === "scored");
    const actual = scored.reduce((sum, p) => sum + p.actual!, 0);
    const comparablePredicted = scored.reduce((sum, p) => sum + p.predicted, 0);
    const absolute = scored.reduce(
      (sum, p) => sum + Math.abs(p.predicted - p.actual!),
      0,
    );
    return {
      id: s.id,
      scopeKey: s.scopeKey,
      skuId: s.skuId,
      skuName: s.skuName,
      provider: s.provider,
      metric: s.metric,
      modelLabel: s.modelLabel,
      scenario: s.scenario,
      points,
      comparablePredicted,
      actual,
      mae: scored.length ? absolute / scored.length : null,
      wape: actual > 0 ? absolute / actual : null,
      bias: scored.length
        ? (comparablePredicted - actual) / scored.length
        : null,
      scoredDays: scored.length,
      pendingDays: points.filter((p) => p.status === "pending").length,
      unknownDays: points.filter((p) => p.status === "unknown").length,
      stockoutDays: points.filter((p) => p.status === "stockout").length,
    };
  });
  return {
    ...forecastJournalSummary({ ...run, series }),
    evaluatedAsOf: asOf,
    rows,
  };
}
