import {
  resolveLaunchForecast,
  isLaunchForecastSource,
} from "./launch-forecast";
import { createHash } from "node:crypto";
import type { MarketplaceResolution } from "../marketplaces/planning-resolutions";
import { PREPARATION_DAYS } from "../marketplaces/unified-plan";
import type { SkuDto } from "../dto";
import type { MarketplaceState } from "../marketplaces/storage";
import type {
  MarketplaceProvider,
  MarketplaceSnapshot,
} from "../marketplaces/providers/types";
import type { ForecastHistorySeries } from "./history-types";
import { runForecast, FORECAST_MODEL_VERSION } from "./engine";
import {
  calibrateFinancialSeason,
  calibrateFinancialCalendarMl,
} from "./forecast-calibration";
import { demandBaseline } from "./demand-baseline";
import { newYearScenario } from "./new-year-scenario";
import {
  runMonthlyHybridForecast,
  applyMonthlySegment,
  MONTHLY_ML_DAYS,
} from "./monthly-hybrid";
import type {
  ForecastModel,
  ForecastResult,
  ForecastSeries,
} from "./engine-types";
import type {
  ForecastCache,
  ForecastPlanGoal,
  ForecastPolicy,
  ForecastPlanSource,
} from "./forecast-storage";
import type {
  ForecastOverviewDto,
  ForecastRowDto,
  ForecastSourceDto,
} from "./forecast-dto";
import {
  forecastJournalScopes,
  forecastChartHistoryKey,
  type ForecastChartIdentity,
  type ForecastJournalRun,
} from "./journal-types";
import {
  buildForecastFeedback,
  forecastFeedbackForSource,
  forecastFeedbackFactor,
  type ForecastFeedbackReport,
} from "./journal-feedback";

export interface ForecastComputeInput {
  key: string;
  asOf: string;
  generatedAt: string;
  skus: SkuDto[];
  policies: ForecastPolicy[];
  /** Sanitized marketplace configuration; encrypted connection values never cross the worker boundary. */
  settings: MarketplaceState["settings"];
  mappings: MarketplaceState["mappings"];
  connections: {
    provider: MarketplaceProvider;
    storeId: string | null;
    version?: number;
  }[];
  resolutions?: MarketplaceResolution[];
  snapshots: MarketplaceSnapshot[];
  series: ForecastHistorySeries[];
  /** Sanitized immutable prior predictions; calibration runs inside the CPU worker. */
  journalRuns?: ForecastJournalRun[];
}
const MODEL_LABELS: Record<ForecastModel, string> = {
  mean: "Средний спрос",
  annual_seasonal: "Прошлогодний сезон",
  annual_growth: "Сезон с поправкой на рост",
  ridge: "ML: месяцы, недели, праздники и тренд",
  autoregressive: "ML: динамика спроса и календарь",
};
const confidenceLabel = (value: ForecastResult["confidence"]) =>
  value === "high"
    ? "Высокая уверенность"
    : value === "medium"
      ? "Умеренная уверенность"
      : "Предварительная оценка";
const modelHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Selection identity deliberately excludes fitted coefficients and translated UI copy. */
export function forecastPlanModelIdentity(
  input: ForecastComputeInput,
  mapping: ForecastComputeInput["mappings"][number],
  policy: ForecastPolicy,
  selection: unknown,
) {
  return modelHash({
    version: FORECAST_MODEL_VERSION,
    mapping: {
      provider: mapping.provider,
      externalId: mapping.externalId,
      skuId: mapping.skuId,
      unitsPerItem: mapping.unitsPerItem,
    },
    seasonalityEnabled: policy.seasonalityEnabled,
    settings: {
      historyDays: input.settings.historyDays,
      horizonDays: input.settings.horizonDays,
      safetyDays: input.settings.safetyDays,
      leadDays: input.settings.leadDays,
      dispatchWeekday: input.settings.dispatchWeekday ?? 6,
    },
    horizon: forecastHorizon(input),
    selection,
  });
}
function sourceKey(
  s: Pick<ForecastHistorySeries, "provider" | "storeId" | "externalId">,
) {
  return JSON.stringify([s.provider, s.storeId, s.externalId]);
}
function netSeries(
  ordered: ForecastHistorySeries,
  cancelled: ForecastHistorySeries | undefined,
): ForecastSeries {
  const cancels = new Map(cancelled?.points.map((p) => [p.date, p]) ?? []);
  return {
    id: sourceKey(ordered),
    provider: ordered.provider,
    storeId: ordered.storeId,
    externalId: ordered.externalId,
    metric: "net_ordered",
    points: ordered.points.map((p) => {
      const c = cancels.get(p.date);
      return {
        date: p.date,
        units:
          p.units !== null && c?.units != null
            ? Math.max(0, p.units - c.units)
            : null,
        availability:
          p.availability === "out_of_stock" ||
          c?.availability === "out_of_stock"
            ? "out_of_stock"
            : p.availability,
      };
    }),
  };
}
export type BaselineInput = Pick<
  ForecastComputeInput,
  "asOf" | "settings" | "mappings" | "snapshots" | "skus" | "policies"
> & {
  series?: ForecastHistorySeries[];
  generatedAt?: string;
  connections?: ForecastComputeInput["connections"];
  resolutions?: MarketplaceResolution[];
};
function isNewYear(input: BaselineInput, skuId: string) {
  const sku = input.skus.find((s) => s.id === skuId);
  return (
    !!sku &&
    sku.name
      .toLocaleLowerCase("ru")
      .replace(/[^а-яёa-z0-9]/g, "")
      .includes("новыйгод") &&
    input.policies.find((p) => p.skuId === skuId)?.seasonalityEnabled !== false
  );
}
function baselineSeries(
  input: BaselineInput,
  provider: MarketplaceProvider,
  externalId: string,
): ForecastSeries {
  const mapping = input.mappings.find(
    (m) => m.provider === provider && m.externalId === externalId,
  );
  const group =
    input.series?.filter(
      (s) =>
        s.provider === provider &&
        s.externalId === externalId &&
        (!input.connections ||
          input.connections.some(
            (c) => c.provider === provider && c.storeId === s.storeId,
          )),
    ) ?? [];
  const ordered = group.find((s) => s.metric === "ordered"),
    cancelled = group.find((s) => s.metric === "cancelled");
  if (ordered && cancelled) return netSeries(ordered, cancelled);
  const snapshot = input.snapshots.find((s) => s.provider === provider);
  const records = (snapshot?.demand ?? [])
    .filter(
      (d) =>
        d.externalId === externalId &&
        d.date >= snapshot!.from &&
        d.date <= snapshot!.to &&
        d.date <= input.asOf,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const counts = new Map<string, number>();
  for (const d of records)
    counts.set(
      d.date,
      (counts.get(d.date) ?? 0) +
        Math.max(0, d.orderedUnits - d.cancelledUnits) *
          (mapping?.unitsPerItem ?? 1),
    );
  const points: ForecastSeries["points"] = [];
  if (records.length)
    for (
      let day = Date.parse(records[0].date);
      day <= Date.parse(input.asOf);
      day += 86400000
    ) {
      const date = new Date(day).toISOString().slice(0, 10),
        complete = !!snapshot?.coverage.demand && date <= snapshot.to;
      points.push({
        date,
        units: counts.get(date) ?? (complete ? 0 : null),
        availability: "unknown",
      });
    }
  return {
    id: JSON.stringify([provider, externalId]),
    provider,
    storeId:
      input.connections?.find((c) => c.provider === provider)?.storeId ??
      provider,
    externalId,
    metric: "net_ordered",
    points,
  };
}
function rawBaselineForecastSource(
  input: BaselineInput,
  provider: MarketplaceProvider,
  externalId: string,
  horizonDays: number,
): Omit<ForecastPlanSource, "provider"> {
  const series = baselineSeries(input, provider, externalId),
    mapping = input.mappings.find(
      (m) => m.provider === provider && m.externalId === externalId,
    );
  const baseline = demandBaseline(
    series.points,
    input.asOf,
    horizonDays,
    input.settings.historyDays,
  );
  const scenario =
    mapping && isNewYear(input, mapping.skuId)
      ? newYearScenario(
          series.points,
          input.asOf,
          horizonDays,
          input.settings.historyDays,
        )
      : null;
  return {
    dailyForecast: scenario?.dailyForecast ?? baseline.dailyForecast,
    methodLabel: scenario?.scenario
      ? "Сценарий к Новому году"
      : baseline.knownDays
        ? "Недавний спрос"
        : "Недостаточно истории",
    confidenceLabel: "Предварительная оценка",
    scenario: scenario?.scenario ?? false,
    salesForecastKnown:
      (!!input.series?.some(
        (s) =>
          s.provider === provider &&
          s.externalId === externalId &&
          s.metric === "ordered" &&
          (!input.connections ||
            input.connections.some(
              (c) => c.provider === provider && c.storeId === s.storeId,
            )),
      ) ||
        input.snapshots.find((s) => s.provider === provider)?.coverage
          .demand === true) &&
      baseline.knownDays > 0 &&
      series.points.some(
        (p) =>
          p.units !== null &&
          p.availability !== "out_of_stock" &&
          p.date <= input.asOf &&
          p.date >=
            new Date(
              Date.parse(input.asOf) -
                (Math.min(14, input.settings.historyDays) - 1) * 86400000,
            )
              .toISOString()
              .slice(0, 10),
      ),
  };
}
export function baselineForecastSource(
  input: BaselineInput,
  provider: MarketplaceProvider,
  externalId: string,
  horizonDays: number,
): Omit<ForecastPlanSource, "provider"> {
  return resolveLaunchForecast(
    input,
    provider,
    externalId,
    horizonDays,
    rawBaselineForecastSource(input, provider, externalId, horizonDays),
    (donorProvider, donorId, days) =>
      rawBaselineForecastSource(input, donorProvider, donorId, days),
  );
}
function forecastHorizon(input: Pick<ForecastComputeInput, "settings">) {
  return Math.max(
    30,
    Math.min(
      366,
      input.settings.horizonDays +
        input.settings.safetyDays +
        input.settings.leadDays +
        (PREPARATION_DAYS - 1),
    ),
  );
}
function baselineContribution(
  input: ForecastComputeInput,
  provider: MarketplaceProvider,
  externalId: string,
): number {
  return baselineForecastSource(
    input,
    provider,
    externalId,
    forecastHorizon(input),
  ).dailyForecast.reduce((n, p) => n + p.units, 0);
}
function chartSource(
  series: ForecastSeries,
  result: ForecastResult,
  provider: MarketplaceProvider,
  metricLabel: string,
  predictedUnits = result.totalUnits,
): ForecastSourceDto {
  return {
    provider,
    metricLabel,
    modelLabel: MODEL_LABELS[result.selectedModel],
    predictedUnits,
    historyDays: result.historyCoverage.knownDays,
    candidates: result.candidates.map((c) => ({
      model: c.model,
      label: MODEL_LABELS[c.model],
      eligible: c.eligible,
      reason: c.reason,
      mae: c.metrics?.mae ?? null,
      wape: c.metrics?.wape ?? null,
      bias: c.metrics?.bias ?? null,
      folds: c.metrics?.folds ?? 0,
    })),
    points: [
      ...series.points
        .filter((p) => p.date <= result.historyCoverage.to)
        .map((p) => ({
          date: p.date,
          actual: p.units,
          predicted: null as number | null,
        })),
      ...result.dailyForecast.map((p) => ({
        date: p.date,
        actual: null as number | null,
        predicted: p.units,
      })),
    ],
  };
}
export function baselineForecastOverview(
  input: ForecastComputeInput,
): ForecastOverviewDto {
  return {
    ready: false,
    computing: true,
    message:
      "Прогноз обновляется. До завершения используется средний спрос и минимальный запас.",
    generatedAt: null,
    rows: input.skus.map((sku): ForecastRowDto => {
      const policy = input.policies.find((p) => p.skuId === sku.id)!;
      const related = input.mappings.filter(
        (m) =>
          m.skuId === sku.id &&
          input.connections.some((c) => c.provider === m.provider),
      );
      const demand = related.reduce(
        (n, m) => n + baselineContribution(input, m.provider, m.externalId),
        0,
      );
      return {
        skuId: sku.id,
        skuName: sku.name,
        minimumBoxes: policy.minimumBoxes,
        seasonalityEnabled: policy.seasonalityEnabled,
        targetUnits: Math.max(
          Math.ceil(demand),
          policy.minimumBoxes * sku.unitsPerBox,
        ),
        seasonalityApplied: false,
        methodLabel: "Средний спрос",
        confidenceLabel: "Предварительная оценка",
        message: related.length
          ? "Сезонность ещё проверяется на истории."
          : "Свяжите тематику с товарами маркетплейсов.",
        historyFrom: null,
        historyTo: null,
        knownDays: 0,
        sources: [],
      };
    }),
  };
}
/** Pure projection. Different metrics remain separate; a cross-metric shape requires its own operational backtest. */
export function computeForecast(input: ForecastComputeInput): ForecastCache {
  const overview = baselineForecastOverview(input),
    fingerprints: string[] = [];
  const horizon = forecastHorizon(input);
  const scopes = forecastJournalScopes(input);
  const chartIdentities: ForecastChartIdentity[] = [];
  const forecastFrom = new Date(Date.parse(input.asOf) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const goalSources = new Map<string, ForecastPlanSource[]>();
  const active = input.series.filter((s) =>
    input.connections.some(
      (c) => c.provider === s.provider && c.storeId === s.storeId,
    ),
  );
  for (const row of overview.rows) {
    const addChart = (
      source: ForecastSourceDto,
      externalId: string,
      metric: ForecastChartIdentity["metric"],
    ) => {
      source.forecastFrom = forecastFrom;
      const scope = scopes.find(
        (item) => item.skuId === row.skuId && item.provider === source.provider,
      );
      const mapping = scope?.mappings.find(
        (item) => item.externalId === externalId,
      );
      if (scope && mapping)
        chartIdentities.push({
          skuId: row.skuId,
          sourceIndex: row.sources.length,
          scopeKey: scope.scopeKey,
          historyKey: forecastChartHistoryKey(
            scope.scopeKey,
            externalId,
            metric,
          ),
          provider: scope.provider,
          storeId: scope.storeId,
          externalId,
          metric,
          unitsPerItem: mapping.unitsPerItem,
        });
      row.sources.push(source);
    };
    const policy = input.policies.find((p) => p.skuId === row.skuId)!;
    const related = input.mappings.filter(
      (m) =>
        m.skuId === row.skuId &&
        input.connections.some((c) => c.provider === m.provider),
    );
    let demand = 0,
      seasonal = 0,
      learned = 0,
      scenarios = 0,
      launches = 0;
    const planSources: ForecastPlanSource[] = [];
    const modelComponents = new Map<MarketplaceProvider, string[]>();
    goalSources.set(row.skuId, planSources);
    const register = (
      provider: MarketplaceProvider,
      source: Omit<ForecastPlanSource, "provider">,
      componentIdentity: string,
    ) => {
      const components = [
        ...(modelComponents.get(provider) ?? []),
        componentIdentity,
      ].sort();
      modelComponents.set(provider, components);
      const modelIdentity = modelHash(components);
      const prior = planSources.find((s) => s.provider === provider);
      if (!prior) {
        planSources.push({ provider, ...source, modelIdentity });
        return;
      }
      prior.modelIdentity = modelIdentity;
      const byDate = new Map(prior.dailyForecast.map((p) => [p.date, p.units]));
      for (const p of source.dailyForecast)
        byDate.set(p.date, (byDate.get(p.date) ?? 0) + p.units);
      prior.dailyForecast = [...byDate]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, units]) => ({ date, units }));
      if (prior.methodLabel !== source.methodLabel)
        prior.methodLabel = "Прогноз спроса";
      if (source.confidenceLabel === "Предварительная оценка")
        prior.confidenceLabel = source.confidenceLabel;
      prior.scenario ||= source.scenario;
      prior.salesForecastKnown =
        prior.salesForecastKnown === true && source.salesForecastKnown === true;
    };
    const confidences: ForecastResult["confidence"][] = [];
    const knownDates = new Set<string>();
    for (const mapping of related) {
      const group = active.filter(
        (s) =>
          s.skuId === row.skuId &&
          s.provider === mapping.provider &&
          s.externalId === mapping.externalId,
      );
      const ordered = group.find((s) => s.metric === "ordered"),
        cancelled = group.find((s) => s.metric === "cancelled");
      const baselineSource = baselineForecastSource(
        { ...input, series: active },
        mapping.provider,
        mapping.externalId,
        horizon,
      );
      const baseline = baselineSource.dailyForecast.reduce(
        (n, p) => n + p.units,
        0,
      );
      if (isLaunchForecastSource(baselineSource)) {
        const observed = ordered
          ? netSeries(ordered, cancelled).points.filter(
              (point) => point.date <= input.asOf,
            )
          : [];
        for (const point of observed)
          if (point.units !== null) knownDates.add(point.date);
        demand += baseline;
        register(
          mapping.provider,
          baselineSource,
          forecastPlanModelIdentity(input, mapping, policy, {
            kind: "launch",
            scenario: true,
          }),
        );
        launches++;
        confidences.push("low");
        addChart(
          {
            provider: mapping.provider,
            metricLabel: "Сценарий запуска — отдельно от наблюдавшихся продаж",
            modelLabel: baselineSource.methodLabel,
            predictedUnits: baseline,
            historyDays: observed.filter((point) => point.units !== null)
              .length,
            candidates: [],
            points: [
              ...observed.map((point) => ({
                date: point.date,
                actual: point.units,
                predicted: null as number | null,
              })),
              ...baselineSource.dailyForecast.map((point) => ({
                date: point.date,
                actual: null,
                predicted: baselineSource.salesForecastKnown
                  ? point.units
                  : null,
              })),
            ],
          },
          mapping.externalId,
          "net_ordered",
        );
        continue;
      }
      if (!ordered) {
        demand += baseline;
        register(
          mapping.provider,
          baselineSource,
          forecastPlanModelIdentity(input, mapping, policy, {
            kind: "baseline",
            scenario: baselineSource.scenario,
            known: baselineSource.salesForecastKnown === true,
          }),
        );
        if (baselineSource.scenario) scenarios++;
        confidences.push("low");
        continue;
      }
      const series = netSeries(ordered, cancelled),
        hybrid = runMonthlyHybridForecast(series, {
          asOf: input.asOf,
          horizonDays: horizon,
          baselineHistoryDays: input.settings.historyDays,
          newYearScenario: isNewYear(input, row.skuId),
        });
      const result = hybrid.long;
      fingerprints.push(hybrid.fingerprint);
      const sold = group.find((s) => s.metric === "sold");
      // Gross sold is an explicitly separate seasonal feature. Returns remain separate,
      // never coalesced into fake zero-return days or added to operational quantities.
      const financial = sold
        ? {
            id: `${sourceKey(sold)}/sold`,
            provider: sold.provider,
            storeId: sold.storeId,
            externalId: sold.externalId,
            points: sold.points,
            metric: "financial_gross_sold",
          }
        : null;
      const annualCalibrated = financial
        ? calibrateFinancialSeason(
            series,
            financial,
            input.asOf,
            horizon,
            input.settings.historyDays,
            isNewYear(input, row.skuId),
          )
        : null;
      const calendarCalibrated = financial
        ? calibrateFinancialCalendarMl(
            series,
            financial,
            input.asOf,
            horizon,
            input.settings.historyDays,
            isNewYear(input, row.skuId),
          )
        : null;
      const calendarMonthly = financial
        ? calibrateFinancialCalendarMl(
            series,
            financial,
            input.asOf,
            MONTHLY_ML_DAYS,
            input.settings.historyDays,
            isNewYear(input, row.skuId),
          )
        : null;
      // Both candidates have independent operational holdouts. A calibrated ML
      // curve never borrows eligibility from financial-only validation.
      const calibrated = calendarCalibrated?.candidate.eligible
        ? calendarCalibrated
        : annualCalibrated;
      for (const candidate of [
        annualCalibrated,
        calendarCalibrated,
        calendarMonthly,
      ])
        if (candidate) fingerprints.push(candidate.fingerprint);
      const directSeasonal =
        policy.seasonalityEnabled &&
        result.selectedModel !== "mean" &&
        result.candidates.some(
          (c) => c.model === result.selectedModel && c.eligible,
        );
      // Prefer a validated direct order model. Different fold sets cannot be ranked
      // by aggregate MAE; calibration is a separately validated fallback.
      const useCalibrated =
        policy.seasonalityEnabled &&
        calibrated?.candidate.eligible &&
        !directSeasonal;
      const useSeasonal = directSeasonal || !!useCalibrated;
      const useFinancialMonthlyMl =
        policy.seasonalityEnabled &&
        !hybrid.usesMonthlyForecast &&
        calendarMonthly?.candidate.eligible === true;
      const useMonthlyMl =
        policy.seasonalityEnabled &&
        (hybrid.usesMonthlyMl || useFinancialMonthlyMl);
      const useMonthlySeasonal =
        policy.seasonalityEnabled && hybrid.usesMonthlySeasonal;
      const useMonthlyForecast =
        policy.seasonalityEnabled &&
        (hybrid.usesMonthlyForecast || useFinancialMonthlyMl);
      const annual =
        useMonthlySeasonal ||
        useCalibrated ||
        (directSeasonal && result.selectedModel !== "autoregressive");
      if (annual) seasonal++;
      if (useMonthlyMl) learned++;
      const scenario =
        !useSeasonal &&
        baselineSource.scenario &&
        (!useMonthlyForecast ||
          baselineSource.dailyForecast.some(
            (p) =>
              p.date > hybrid.monthly.dailyForecast.at(-1)!.date &&
              p.date.slice(0, 4) === input.asOf.slice(0, 4) &&
              p.date.slice(5, 7) >= "11",
          ));
      if (scenario) scenarios++;
      const tailForecast = useCalibrated
        ? calibrated!.dailyForecast
        : directSeasonal
          ? result.dailyForecast
          : baselineSource.dailyForecast;
      const monthlyFinancialByDay = new Map(
        calendarMonthly?.dailyForecast.map((p) => [p.date, p.units]) ?? [],
      );
      const dailyForecast = useFinancialMonthlyMl
        ? tailForecast.map((p) => ({
            date: p.date,
            units: monthlyFinancialByDay.get(p.date) ?? p.units,
          }))
        : useMonthlyForecast
          ? applyMonthlySegment(hybrid.monthly, tailForecast)
          : tailForecast;
      const predictedUnits = dailyForecast.reduce((n, p) => n + p.units, 0);
      demand += predictedUnits;
      const methodLabel = useMonthlyMl
        ? `ML: ближайшие ${MONTHLY_ML_DAYS} дней; далее ${scenario ? "предпраздничный сценарий" : useSeasonal ? "сезонный прогноз" : "текущий спрос"}`
        : useMonthlySeasonal
          ? `${MODEL_LABELS[hybrid.monthly.selectedModel]}: ближайшие ${MONTHLY_ML_DAYS} дней; далее ${scenario ? "предпраздничный сценарий" : useSeasonal ? "сезонный прогноз" : "текущий спрос"}`
          : useCalibrated
            ? calibrated!.candidate.label
            : directSeasonal
              ? MODEL_LABELS[result.selectedModel]
              : baselineSource.methodLabel;
      register(
        mapping.provider,
        {
          dailyForecast,
          methodLabel,
          confidenceLabel: useFinancialMonthlyMl
            ? "Умеренная уверенность"
            : useMonthlyForecast
              ? confidenceLabel(hybrid.monthly.confidence)
              : useCalibrated
                ? "Умеренная уверенность"
                : useSeasonal
                  ? confidenceLabel(result.confidence)
                  : baselineSource.confidenceLabel,
          scenario,
          salesForecastKnown:
            useMonthlyForecast ||
            useSeasonal ||
            baselineSource.salesForecastKnown === true,
        },
        forecastPlanModelIdentity(input, mapping, policy, {
          kind: "operational",
          scenario,
          monthly: useFinancialMonthlyMl
            ? "financial_calendar_ml"
            : useMonthlyForecast
              ? hybrid.monthly.selectedModel
              : null,
          tail: useCalibrated
            ? calibrated!.candidate.model
            : directSeasonal
              ? result.selectedModel
              : baselineSource.scenario
                ? "new_year_scenario"
                : "recent_demand",
        }),
      );
      confidences.push(
        useFinancialMonthlyMl
          ? "medium"
          : useMonthlyForecast
            ? hybrid.monthly.confidence
            : useCalibrated
              ? "medium"
              : useSeasonal
                ? result.confidence
                : "low",
      );
      for (const point of series.points)
        if (point.units !== null && point.date <= input.asOf)
          knownDates.add(point.date);
      const source = chartSource(
        series,
        result,
        mapping.provider,
        "Заказы за вычетом отмен",
        predictedUnits,
      );
      const monthlyCandidate = hybrid.monthly.candidates.find(
        (c) => c.model === "autoregressive",
      )!;
      const monthlyMetrics = monthlyCandidate.metrics?.byHorizon.find(
        (m) => m.horizonDays === MONTHLY_ML_DAYS,
      );
      source.candidates = source.candidates.map((c) =>
        c.model === "autoregressive"
          ? {
              model: c.model,
              label: `ML: прогноз на ${MONTHLY_ML_DAYS} дней`,
              eligible: monthlyCandidate.eligible,
              reason: monthlyCandidate.eligible
                ? `Проверено на горизонте ${MONTHLY_ML_DAYS} дней; более дальние даты оцениваются отдельно.`
                : `Горизонт ${MONTHLY_ML_DAYS} дней: ${monthlyCandidate.reason}`,
              mae: monthlyMetrics?.mae ?? null,
              wape: monthlyMetrics?.wape ?? null,
              bias: monthlyMetrics?.bias ?? null,
              folds: monthlyMetrics?.folds ?? 0,
            }
          : {
              ...c,
              reason:
                c.model === "mean"
                  ? "Базовая оценка недавнего спроса; не является подтверждением ML на рабочем горизонте."
                  : c.eligible
                    ? `Проверено на горизонте ${horizon} дней.`
                    : c.reason,
            },
      );
      const calendarMonthlyCandidate = hybrid.monthly.candidates.find(
        (c) => c.model === "ridge",
      )!;
      const calendarMonthlyMetrics =
        calendarMonthlyCandidate.metrics?.byHorizon.find(
          (m) => m.horizonDays === MONTHLY_ML_DAYS,
        );
      source.candidates.push({
        model: "ridge_monthly",
        label: "ML: месяцы, недели и праздники на 30 дней",
        eligible: calendarMonthlyCandidate.eligible,
        reason: calendarMonthlyCandidate.reason,
        mae: calendarMonthlyMetrics?.mae ?? null,
        wape: calendarMonthlyMetrics?.wape ?? null,
        bias: calendarMonthlyMetrics?.bias ?? null,
        folds: calendarMonthlyMetrics?.folds ?? 0,
      });
      for (const model of ["annual_seasonal", "annual_growth"] as const) {
        const candidate = hybrid.monthly.candidates.find(
          (c) => c.model === model,
        )!;
        const metrics = candidate.metrics?.byHorizon.find(
          (m) => m.horizonDays === MONTHLY_ML_DAYS,
        );
        source.candidates.push({
          model: `${model}_monthly`,
          label: `${MODEL_LABELS[model]}: 30 дней`,
          eligible: candidate.eligible,
          reason: candidate.eligible
            ? "Проверено на горизонте 30 дней; дальний запас оценивается отдельно."
            : candidate.reason,
          mae: metrics?.mae ?? null,
          wape: metrics?.wape ?? null,
          bias: metrics?.bias ?? null,
          folds: metrics?.folds ?? 0,
        });
      }
      for (const c of [annualCalibrated, calendarCalibrated])
        if (c) source.candidates.push(c.candidate);
      if (calendarMonthly)
        source.candidates.push({
          ...calendarMonthly.candidate,
          model: "financial_calendar_ml_monthly",
          label: "ML: календарь всей истории выкупов → заказы на 30 дней",
        });
      source.modelLabel = methodLabel;
      source.points = [
        ...source.points.filter((p) => p.predicted === null),
        ...dailyForecast.map((p) => ({
          date: p.date,
          actual: null,
          predicted: p.units,
        })),
      ];
      addChart(source, mapping.externalId, "net_ordered");
    }
    // Never mix financial sales/returns into an operational order forecast.
    for (const history of active.filter(
      (s) =>
        s.skuId === row.skuId &&
        (s.metric === "sold" || s.metric === "returned"),
    )) {
      const series: ForecastSeries = {
        id: `${sourceKey(history)}/${history.metric}`,
        provider: history.provider,
        storeId: history.storeId,
        externalId: history.externalId,
        metric: history.metric,
        points: history.points,
      };
      const result = runForecast(series, {
        asOf: input.asOf,
        horizonDays: MONTHLY_ML_DAYS,
        baselineHistoryDays: input.settings.historyDays,
      });
      fingerprints.push(result.fingerprint);
      if (history.metric === "sold")
        for (const point of series.points)
          if (
            point.units !== null &&
            point.date <= input.asOf &&
            point.availability !== "out_of_stock"
          )
            knownDates.add(point.date);
      addChart(
        chartSource(
          series,
          result,
          history.provider,
          history.metric === "sold"
            ? "Выкупы — прогноз на 30 дней, отдельно от заказов"
            : "Возвраты — прогноз на 30 дней, отдельно от заказов",
        ),
        history.externalId,
        history.metric === "sold" ? "sold" : "returned",
      );
    }
    const sku = input.skus.find((s) => s.id === row.skuId)!;
    row.targetUnits = Math.max(
      Math.ceil(demand),
      policy.minimumBoxes * sku.unitsPerBox,
    );
    row.seasonalityApplied = seasonal > 0;
    row.methodLabel = launches
      ? "Прогноз запуска новинки"
      : learned
        ? "ML: ближайшие 30 дней; дальше — отдельная оценка"
        : seasonal
          ? "Прогноз с сезонностью"
          : scenarios
            ? "Сценарий к Новому году"
            : "Недавний спрос";
    row.confidenceLabel = confidenceLabel(
      confidences.length && confidences.every((c) => c === "high")
        ? "high"
        : confidences.length && confidences.every((c) => c !== "low")
          ? "medium"
          : "low",
    );
    const dates = [...knownDates].sort();
    row.historyFrom = dates[0] ?? null;
    row.historyTo = dates.at(-1) ?? null;
    row.knownDays = dates.length;
    row.message = launches
      ? "Запуск на новой площадке оценивается по продажам этого товара на другой площадке и соотношению спроса похожих тематик. Это предварительный сценарий; после накопления собственных продаж прогноз пересчитается."
      : learned
        ? "ML-прогноз количества продаж проверен на ближайшие 30 дней. Более дальний запас оценивается отдельно по сезонности или текущему спросу."
        : seasonal
          ? "Сезонная модель проверена на прошлом и учитывает текущую динамику продаж."
          : scenarios
            ? "Сценарий к Новому году: сохраняем наблюдаемый рост только до конца декабря. Годовая сезонность пока не подтверждена."
            : !policy.seasonalityEnabled
              ? "Автопрогноз отключён. Используется недавний спрос."
              : related.length
                ? "Сложные модели пока не подтвердили преимущество; учитываем недавний спрос и известные дни после появления товара."
                : "Свяжите тематику с товарами маркетплейсов.";
  }
  overview.ready = true;
  overview.computing = false;
  overview.generatedAt = input.generatedAt;
  overview.message = overview.rows.some((r) => r.seasonalityApplied)
    ? "Прогноз учитывает проверенную сезонность. Остатки и поставки вычитаются в плане сборки."
    : "Прогноз учитывает недавний спрос. Обучаемые модели применяются после проверки на прошлом.";
  const goals: Record<string, ForecastPlanGoal> = Object.fromEntries(
    overview.rows.map((r) => [
      r.skuId,
      {
        targetUnits: r.targetUnits,
        methodLabel: r.methodLabel,
        confidenceLabel: r.confidenceLabel,
        message: r.message,
        seasonalityApplied: r.seasonalityApplied,
        sources: goalSources.get(r.skuId) ?? [],
      },
    ]),
  );
  const availableFeedback = buildForecastFeedback(
    input.journalRuns ?? [],
    active,
    input.asOf,
    FORECAST_MODEL_VERSION,
    scopes.map((scope) => scope.scopeKey),
  );
  const journalFeedback: ForecastFeedbackReport[] = [];
  for (const scope of scopes) {
    const goal = goals[scope.skuId];
    const planSource = goal?.sources?.find(
      (source) => source.provider === scope.provider,
    );
    if (!planSource || planSource.salesForecastKnown !== true) continue;
    // Capture the untouched curve before any correction. The next fit must never
    // learn another multiplier from an already multiplied denominator.
    planSource.journalBaseForecast = planSource.dailyForecast.map((point) => ({
      ...point,
    }));
    if (planSource.scenario) continue;
    const feedback = forecastFeedbackForSource(availableFeedback, {
      scopeKey: scope.scopeKey,
      skuId: scope.skuId,
      provider: scope.provider,
      modelVersion: FORECAST_MODEL_VERSION,
      modelLabel: planSource.methodLabel,
      modelIdentity: planSource.modelIdentity!,
    });
    journalFeedback.push(...feedback);
    if (!feedback.some((report) => report.status === "active")) continue;
    planSource.dailyForecast = planSource.dailyForecast.map((point) => ({
      ...point,
      units:
        point.units *
        forecastFeedbackFactor(feedback, point.date, input.generatedAt),
    }));
    const row = overview.rows.find((item) => item.skuId === scope.skuId)!;
    for (const chart of row.sources.filter(
      (source) =>
        source.provider === scope.provider &&
        source.metricLabel === "Заказы за вычетом отмен",
    )) {
      chart.points = chart.points.map((point) =>
        point.predicted === null
          ? point
          : {
              ...point,
              predicted:
                point.predicted *
                forecastFeedbackFactor(feedback, point.date, input.generatedAt),
            },
      );
      chart.predictedUnits = chart.points.reduce(
        (sum, point) => sum + (point.predicted ?? 0),
        0,
      );
    }
  }
  for (const row of overview.rows) {
    const goal = goals[row.skuId];
    const sku = input.skus.find((item) => item.id === row.skuId)!;
    goal.targetUnits = Math.max(
      row.minimumBoxes * sku.unitsPerBox,
      Math.ceil(
        (goal.sources ?? []).reduce(
          (sum, source) =>
            sum +
            source.dailyForecast.reduce(
              (subtotal, point) => subtotal + point.units,
              0,
            ),
          0,
        ),
      ),
    );
    row.targetUnits = goal.targetUnits;
  }
  return {
    key: input.key,
    generatedAt: input.generatedAt,
    overview,
    goals,
    modelVersion: FORECAST_MODEL_VERSION,
    fingerprints,
    journalFeedback,
    chartIdentities,
  };
}
