import { createHash } from "node:crypto";
import type { MarketplaceProvider } from "../marketplaces/providers/types";
import type { ForecastComputeInput } from "./forecast-projection";
import type { ForecastCache } from "./forecast-storage";
import { journalActualPoints } from "./journal-comparison";

export type ForecastJournalInput = Pick<
  ForecastComputeInput,
  | "key"
  | "generatedAt"
  | "asOf"
  | "skus"
  | "settings"
  | "mappings"
  | "connections"
> &
  Partial<Pick<ForecastComputeInput, "series" | "journalRuns">>;
export interface ForecastJournalScope {
  scopeKey: string;
  skuId: string;
  skuName: string;
  provider: MarketplaceProvider;
  storeId: string;
  mappings: { externalId: string; unitsPerItem: number }[];
  unitsPerBox: number;
}
export interface ForecastJournalPoint {
  date: string;
  /** Forecast before error correction; never reconstructed from a later model. */
  baseUnits: number;
  units: number;
  factor: number;
}
export interface ForecastJournalSeries extends ForecastJournalScope {
  id: string;
  metric: "net_ordered";
  modelLabel: string;
  /** Missing on legacy archives: never eligible for automatic correction. */
  modelIdentity?: string;
  scenario: boolean;
  points: ForecastJournalPoint[];
}
export interface ForecastJournalObservedActual {
  scopeKey: string;
  date: string;
  units: number;
  stockout: boolean;
}
export interface ForecastJournalRun {
  id: string;
  generatedAt: string;
  /** Actual successful publication time, not training cutoff or backdated issue time. */
  publishedAt: string;
  asOf: string;
  modelVersion: string;
  settings: {
    historyDays: number;
    horizonDays: number;
    safetyDays: number;
    leadDays: number;
    dispatchWeekday: number;
  };
  series: ForecastJournalSeries[];
  /** Exact fact versions seen at this publication, limited to matured earlier predictions. */
  observedActuals?: ForecastJournalObservedActual[];
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Stable account + mapped pack identity; credential rotation alone does not change the seller. */
export function forecastJournalScopes(
  input: ForecastJournalInput,
): ForecastJournalScope[] {
  const scopes: ForecastJournalScope[] = [];
  for (const sku of input.skus) {
    for (const connection of input.connections) {
      if (!connection.storeId) continue;
      const mappings = input.mappings
        .filter((m) => m.skuId === sku.id && m.provider === connection.provider)
        .map(({ externalId, unitsPerItem }) => ({ externalId, unitsPerItem }))
        .sort(
          (a, b) =>
            a.externalId.localeCompare(b.externalId) ||
            a.unitsPerItem - b.unitsPerItem,
        );
      if (!mappings.length) continue;
      const identity = [
        connection.provider,
        connection.storeId,
        sku.id,
        sku.unitsPerBox,
        mappings,
      ];
      scopes.push({
        scopeKey: hash(identity),
        skuId: sku.id,
        skuName: sku.name,
        provider: connection.provider,
        storeId: connection.storeId,
        mappings,
        unitsPerBox: sku.unitsPerBox,
      });
    }
  }
  return scopes;
}
/** Captures only future quantities, never duplicates years of historical chart data. */
export function captureForecastJournal(
  input: ForecastJournalInput,
  cache: ForecastCache,
  publishedAt: string,
): ForecastJournalRun {
  if (cache.key !== input.key)
    throw new Error("Cannot archive a superseded forecast");
  const series: ForecastJournalSeries[] = [];
  for (const scope of forecastJournalScopes(input)) {
    const source = cache.goals[scope.skuId]?.sources?.find(
      (s) => s.provider === scope.provider,
    );
    if (!source || source.salesForecastKnown !== true) continue;
    const base = new Map(
      (
        source as typeof source & {
          journalBaseForecast?: { date: string; units: number }[];
        }
      ).journalBaseForecast?.map((p) => [p.date, p.units]) ?? [],
    );
    const points = source.dailyForecast
      .filter((p) => p.date > input.asOf)
      .map((p) => {
        const baseUnits = base.get(p.date) ?? p.units;
        if (
          !Number.isFinite(p.units) ||
          p.units < 0 ||
          !Number.isFinite(baseUnits) ||
          baseUnits < 0
        )
          throw new Error("Invalid forecast journal quantity");
        return {
          date: p.date,
          baseUnits,
          units: p.units,
          factor: baseUnits > 0 ? p.units / baseUnits : 1,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!points.length) continue;
    if (new Set(points.map((p) => p.date)).size !== points.length)
      throw new Error("Duplicate forecast date");
    series.push({
      ...scope,
      id: hash([scope.scopeKey, "net_ordered"]),
      metric: "net_ordered",
      modelLabel: source.methodLabel,
      modelIdentity: source.modelIdentity,
      scenario: source.scenario,
      points,
    });
  }
  return {
    id: input.key,
    generatedAt: cache.generatedAt,
    publishedAt,
    asOf: input.asOf,
    modelVersion: cache.modelVersion,
    settings: {
      historyDays: input.settings.historyDays,
      horizonDays: input.settings.horizonDays,
      safetyDays: input.settings.safetyDays,
      leadDays: input.settings.leadDays,
      dispatchWeekday: input.settings.dispatchWeekday ?? 6,
    },
    series,
    observedActuals: captureObservedActuals(input, publishedAt),
  };
}

/** No reconstructed past knowledge: a fact becomes known at this publication only. */
function captureObservedActuals(
  input: ForecastJournalInput,
  publishedAt: string,
): ForecastJournalObservedActual[] {
  if (!input.series?.length || !input.journalRuns?.length) return [];
  const active = new Set(
    forecastJournalScopes(input).map((scope) => scope.scopeKey),
  );
  const publishedDay = new Date(Date.parse(publishedAt) + 10_800_000)
    .toISOString()
    .slice(0, 10);
  const targets = new Map<
    string,
    { series: ForecastJournalSeries; dates: Set<string> }
  >();
  for (const prior of input.journalRuns) {
    if (Date.parse(prior.publishedAt) >= Date.parse(publishedAt)) continue;
    const priorDay = new Date(Date.parse(prior.publishedAt) + 10_800_000)
      .toISOString()
      .slice(0, 10);
    for (const series of prior.series) {
      if (series.metric !== "net_ordered" || !active.has(series.scopeKey))
        continue;
      let group = targets.get(series.scopeKey);
      if (!group) {
        group = { series, dates: new Set() };
        targets.set(series.scopeKey, group);
      }
      for (const point of series.points) {
        if (
          point.date > priorDay &&
          point.date <= input.asOf &&
          point.date < publishedDay
        )
          group.dates.add(point.date);
      }
    }
  }
  const facts: ForecastJournalObservedActual[] = [];
  for (const [scopeKey, group] of targets) {
    const points = [...group.dates]
      .sort()
      .map((date) => ({ date, baseUnits: 0, units: 0, factor: 1 }));
    const actuals = journalActualPoints(
      { ...group.series, points },
      input.series,
    );
    for (const [date, point] of actuals) {
      if (
        point.actual !== null &&
        Number.isFinite(point.actual) &&
        point.actual >= 0
      )
        facts.push({
          scopeKey,
          date,
          units: point.actual,
          stockout: point.stockout,
        });
    }
  }
  return facts;
}
