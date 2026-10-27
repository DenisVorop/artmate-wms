import type { MarketplaceProvider } from "../marketplaces/providers/types";
import type { ForecastHistorySeries } from "./history-types";
import { journalActualPoints } from "./journal-comparison";
import type { ForecastJournalRun } from "./journal-types";

export type ForecastFeedbackBucket = "1-7" | "8-30";
export interface ForecastFeedbackReport {
  scopeKey: string;
  skuId: string;
  provider: MarketplaceProvider;
  modelVersion: string;
  modelLabel: string;
  modelIdentity: string;
  bucket: ForecastFeedbackBucket;
  status: "waiting" | "insufficient_volume" | "no_improvement" | "active";
  factor: number;
  observedDays: number;
  improvement: number | null;
  validatedFolds: number;
  winningFolds: number;
}
interface Observation {
  date: string;
  publishedDay: string;
  publishedAt: string;
  lead: number;
  base: number;
  actual: number;
  knownSnapshots: {
    publishedAt: string;
    publishedDay: string;
    units: number;
    stockout: boolean;
  }[];
}
const DAY_MS = 86_400_000;
const dayOf = (timestamp: string) =>
  new Date(Date.parse(timestamp) + 10_800_000).toISOString().slice(0, 10);
const offset = (date: string, days: number) =>
  new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
export function forecastFeedbackBucket(
  lead: number,
): ForecastFeedbackBucket | null {
  return lead >= 1 && lead <= 7
    ? "1-7"
    : lead >= 8 && lead <= 30
      ? "8-30"
      : null;
}
const identity = (
  scopeKey: string,
  modelVersion: string,
  modelIdentity: string,
  bucket: ForecastFeedbackBucket,
) => JSON.stringify([scopeKey, modelVersion, modelIdentity, bucket]);

/** Small samples stay close to one; no multiplier can move demand by more than 25%. */
function fitFactor(points: Observation[]): number | null {
  const base = points.reduce((sum, point) => sum + point.base, 0);
  const actual = points.reduce((sum, point) => sum + point.actual, 0);
  if (base < 20 || actual < 20) return null;
  const weight = points.length / (points.length + 14);
  return Math.min(1.25, Math.max(0.75, 1 + (actual / base - 1) * weight));
}
function actualKnownBefore(point: Observation, cutoff: string): boolean {
  for (let index = point.knownSnapshots.length - 1; index >= 0; index--) {
    const snapshot = point.knownSnapshots[index];
    if (snapshot.publishedDay < cutoff)
      return !snapshot.stockout && snapshot.units === point.actual;
  }
  return false;
}
function evaluate(
  report: ForecastFeedbackReport,
  observations: Observation[],
): ForecastFeedbackReport {
  const points = [...observations].sort((a, b) => a.date.localeCompare(b.date));
  report.observedDays = points.length;
  if (points.length < 35) return report;
  const factor = fitFactor(points);
  if (factor === null) return { ...report, status: "insufficient_volume" };
  // Three contiguous calendar weeks; gaps are not quietly replaced with zeros.
  const end = points.at(-1)!.date;
  const byDay = new Map(points.map((point) => [point.date, point]));
  let baselineError = 0,
    adjustedError = 0;
  for (let fold = 0; fold < 3; fold++) {
    const start = offset(end, -20 + fold * 7);
    const heldout = Array.from({ length: 7 }, (_, day) =>
      byDay.get(offset(start, day)),
    );
    if (heldout.some((point) => point === undefined)) return report;
    const complete = heldout as Observation[];
    const issueCutoff = complete.reduce(
      (earliest, point) =>
        point.publishedDay < earliest ? point.publishedDay : earliest,
      start,
    );
    // A correction for a held-out forecast can use only days already complete
    // before that forecast was issued, not merely before its target date.
    const training = points.filter(
      (point) =>
        point.date < issueCutoff && actualKnownBefore(point, issueCutoff),
    );
    if (training.length < 14) return report;
    const foldFactor = fitFactor(training);
    if (foldFactor === null)
      return { ...report, status: "insufficient_volume" };
    const baseError = complete.reduce(
      (sum, point) => sum + Math.abs(point.actual - point.base),
      0,
    );
    const correctedError = complete.reduce(
      (sum, point) => sum + Math.abs(point.actual - point.base * foldFactor),
      0,
    );
    baselineError += baseError;
    adjustedError += correctedError;
    report.validatedFolds++;
    if (correctedError < baseError) report.winningFolds++;
  }
  const improvement =
    baselineError > 0 ? (baselineError - adjustedError) / baselineError : 0;
  if (improvement < 0.05 || report.winningFolds < 2)
    return { ...report, status: "no_improvement", improvement };
  return { ...report, status: "active", factor, improvement };
}

/** Pure worker work. Actuals are current, but issued forecasts and their raw bases remain immutable. */
export function buildForecastFeedback(
  runs: ForecastJournalRun[],
  history: ForecastHistorySeries[],
  asOf: string,
  modelVersion: string,
  activeScopeKeys?: string[],
): ForecastFeedbackReport[] {
  const allowed = activeScopeKeys ? new Set(activeScopeKeys) : null;
  const knownActuals = new Map<string, Observation["knownSnapshots"]>();
  const factKey = (scopeKey: string, date: string) =>
    JSON.stringify([scopeKey, date]);
  for (const run of runs) {
    if (!Number.isFinite(Date.parse(run.publishedAt))) continue;
    const publishedDay = dayOf(run.publishedAt);
    for (const observed of run.observedActuals ?? []) {
      if (
        observed.date >= publishedDay ||
        observed.date > run.asOf ||
        !Number.isFinite(observed.units) ||
        observed.units < 0
      )
        continue;
      const key = factKey(observed.scopeKey, observed.date);
      const versions = knownActuals.get(key) ?? [];
      versions.push({
        publishedAt: run.publishedAt,
        publishedDay,
        units: observed.units,
        stockout: observed.stockout,
      });
      knownActuals.set(key, versions);
    }
  }
  for (const versions of knownActuals.values())
    versions.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  const groups = new Map<
    string,
    { report: ForecastFeedbackReport; points: Map<string, Observation> }
  >();
  for (const run of runs) {
    if (
      run.modelVersion !== modelVersion ||
      !Number.isFinite(Date.parse(run.publishedAt))
    )
      continue;
    const publishedDay = dayOf(run.publishedAt);
    if (publishedDay >= asOf) continue;
    for (const series of run.series) {
      if (
        series.metric !== "net_ordered" ||
        !series.modelIdentity ||
        series.scenario ||
        (allowed && !allowed.has(series.scopeKey))
      )
        continue;
      const actuals = journalActualPoints(series, history);
      for (const point of series.points) {
        if (point.date > asOf || point.date <= publishedDay) continue;
        const actual = actuals.get(point.date);
        if (
          !actual ||
          actual.actual === null ||
          actual.stockout ||
          !Number.isFinite(actual.actual) ||
          actual.actual < 0 ||
          !Number.isFinite(point.baseUnits) ||
          point.baseUnits < 0
        )
          continue;
        const lead = Math.round(
          (Date.parse(point.date) - Date.parse(publishedDay)) / DAY_MS,
        );
        const bucket = forecastFeedbackBucket(lead);
        if (!bucket) continue;
        const key = identity(
          series.scopeKey,
          modelVersion,
          series.modelIdentity,
          bucket,
        );
        let group = groups.get(key);
        if (!group) {
          group = {
            report: {
              scopeKey: series.scopeKey,
              skuId: series.skuId,
              provider: series.provider,
              modelVersion,
              modelLabel: series.modelLabel,
              modelIdentity: series.modelIdentity,
              bucket,
              status: "waiting",
              factor: 1,
              observedDays: 0,
              improvement: null,
              validatedFolds: 0,
              winningFolds: 0,
            },
            points: new Map(),
          };
          groups.set(key, group);
        }
        const observation: Observation = {
          date: point.date,
          publishedDay,
          publishedAt: run.publishedAt,
          lead,
          base: point.baseUnits,
          actual: actual.actual,
          knownSnapshots:
            knownActuals.get(factKey(series.scopeKey, point.date)) ?? [],
        };
        const previous = group.points.get(point.date);
        // Each target date has one vote in its lead bucket. Earlier issue wins,
        // so frequent 30-minute recalculations cannot dominate the sample.
        if (
          !previous ||
          lead > previous.lead ||
          (lead === previous.lead && run.publishedAt < previous.publishedAt)
        )
          group.points.set(point.date, observation);
      }
    }
  }
  return [...groups.values()].map(({ report, points }) =>
    evaluate(report, [...points.values()]),
  );
}

export function forecastFeedbackForSource(
  reports: ForecastFeedbackReport[],
  source: Pick<
    ForecastFeedbackReport,
    | "scopeKey"
    | "skuId"
    | "provider"
    | "modelVersion"
    | "modelLabel"
    | "modelIdentity"
  >,
): ForecastFeedbackReport[] {
  return (["1-7", "8-30"] as const).map(
    (bucket) =>
      reports.find(
        (report) =>
          identity(
            report.scopeKey,
            report.modelVersion,
            report.modelIdentity,
            report.bucket,
          ) ===
          identity(
            source.scopeKey,
            source.modelVersion,
            source.modelIdentity,
            bucket,
          ),
      ) ?? {
        ...source,
        bucket,
        status: "waiting",
        factor: 1,
        observedDays: 0,
        improvement: null,
        validatedFolds: 0,
        winningFolds: 0,
      },
  );
}

export function forecastFeedbackFactor(
  reports: ForecastFeedbackReport[],
  date: string,
  generatedAt: string,
): number {
  const lead = Math.round(
    (Date.parse(date) - Date.parse(dayOf(generatedAt))) / DAY_MS,
  );
  const bucket = forecastFeedbackBucket(lead);
  return (
    reports.find(
      (report) => report.bucket === bucket && report.status === "active",
    )?.factor ?? 1
  );
}
