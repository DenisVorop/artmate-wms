import type { SkuDto } from "../dto";
import type { MarketplaceState } from "../marketplaces/storage";
import type {
  MarketplaceProvider,
  MarketplaceSnapshot,
} from "../marketplaces/providers/types";
import type { ForecastHistorySeries } from "./history-types";
import { runForecast, FORECAST_MODEL_VERSION } from "./engine";
import { calibrateFinancialSeason } from "./forecast-calibration";
import { demandBaseline } from "./demand-baseline";
import { newYearScenario } from "./new-year-scenario";
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

export interface ForecastComputeInput {
  key: string;
  asOf: string;
  generatedAt: string;
  skus: SkuDto[];
  policies: ForecastPolicy[];
  /** Sanitized marketplace configuration; encrypted connection values never cross the worker boundary. */
  settings: MarketplaceState["settings"];
  mappings: MarketplaceState["mappings"];
  connections: { provider: MarketplaceProvider; storeId: string | null }[];
  snapshots: MarketplaceSnapshot[];
  series: ForecastHistorySeries[];
}
const MODEL_LABELS: Record<ForecastModel, string> = {
  mean: "Средний спрос",
  annual_seasonal: "Прошлогодний сезон",
  annual_growth: "Сезон с поправкой на рост",
  ridge: "Сезонная модель и тренд",
  autoregressive: "Обучаемая модель спроса",
};
const confidenceLabel = (value: ForecastResult["confidence"]) =>
  value === "high"
    ? "Высокая уверенность"
    : value === "medium"
      ? "Умеренная уверенность"
      : "Предварительная оценка";
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
type BaselineInput = Pick<
  ForecastComputeInput,
  "asOf" | "settings" | "mappings" | "snapshots" | "skus" | "policies"
> & {
  series?: ForecastHistorySeries[];
  connections?: ForecastComputeInput["connections"];
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
export function baselineForecastSource(
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
  };
}
function forecastHorizon(input: Pick<ForecastComputeInput, "settings">) {
  return Math.min(
    366,
    input.settings.horizonDays +
      input.settings.safetyDays +
      input.settings.leadDays +
      6,
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
  const goalSources = new Map<string, ForecastPlanSource[]>();
  const active = input.series.filter((s) =>
    input.connections.some(
      (c) => c.provider === s.provider && c.storeId === s.storeId,
    ),
  );
  for (const row of overview.rows) {
    const policy = input.policies.find((p) => p.skuId === row.skuId)!;
    const related = input.mappings.filter(
      (m) =>
        m.skuId === row.skuId &&
        input.connections.some((c) => c.provider === m.provider),
    );
    let demand = 0,
      seasonal = 0,
      learned = 0,
      scenarios = 0;
    const planSources: ForecastPlanSource[] = [];
    goalSources.set(row.skuId, planSources);
    const register = (
      provider: MarketplaceProvider,
      source: Omit<ForecastPlanSource, "provider">,
    ) => {
      const prior = planSources.find((s) => s.provider === provider);
      if (!prior) {
        planSources.push({ provider, ...source });
        return;
      }
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
      if (!ordered) {
        demand += baseline;
        register(mapping.provider, baselineSource);
        if (baselineSource.scenario) scenarios++;
        confidences.push("low");
        continue;
      }
      const series = netSeries(ordered, cancelled),
        result = runForecast(series, {
          asOf: input.asOf,
          horizonDays: horizon,
          baselineHistoryDays: input.settings.historyDays,
          newYearScenario: isNewYear(input, row.skuId),
        });
      fingerprints.push(result.fingerprint);
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
      const calibrated = financial
        ? calibrateFinancialSeason(
            series,
            financial,
            input.asOf,
            horizon,
            input.settings.historyDays,
            isNewYear(input, row.skuId),
          )
        : null;
      if (calibrated) fingerprints.push(calibrated.fingerprint);
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
      const predictedUnits = useCalibrated
        ? calibrated!.totalUnits
        : directSeasonal
          ? result.totalUnits
          : baseline;
      demand += predictedUnits;
      const annual =
        useCalibrated ||
        (directSeasonal && result.selectedModel !== "autoregressive");
      if (annual) seasonal++;
      if (directSeasonal && result.selectedModel === "autoregressive")
        learned++;
      const scenario = !useSeasonal && baselineSource.scenario;
      if (scenario) scenarios++;
      const dailyForecast = useCalibrated
        ? calibrated!.dailyForecast
        : directSeasonal
          ? result.dailyForecast
          : baselineSource.dailyForecast;
      register(mapping.provider, {
        dailyForecast,
        methodLabel: useCalibrated
          ? calibrated!.candidate.label
          : directSeasonal
            ? MODEL_LABELS[result.selectedModel]
            : baselineSource.methodLabel,
        confidenceLabel: useCalibrated
          ? "Умеренная уверенность"
          : useSeasonal
            ? confidenceLabel(result.confidence)
            : baselineSource.confidenceLabel,
        scenario,
      });
      confidences.push(
        useCalibrated ? "medium" : useSeasonal ? result.confidence : "low",
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
      if (calibrated) source.candidates.push(calibrated.candidate);
      if (useCalibrated) {
        source.modelLabel = calibrated!.candidate.label;
        source.points = [
          ...source.points.filter(
            (p) => p.actual !== null || p.predicted === null,
          ),
          ...calibrated!.dailyForecast.map((p) => ({
            date: p.date,
            actual: null,
            predicted: p.units,
          })),
        ];
      }
      if (!useSeasonal) {
        source.modelLabel = baselineSource.methodLabel;
        const byDate = new Map(
          baselineSource.dailyForecast.map((p) => [p.date, p.units]),
        );
        source.points = source.points.map((p) =>
          p.predicted !== null
            ? { ...p, predicted: byDate.get(p.date) ?? null }
            : p,
        );
      }
      row.sources.push(source);
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
        horizonDays: horizon,
        baselineHistoryDays: input.settings.historyDays,
      });
      fingerprints.push(result.fingerprint);
      row.sources.push(
        chartSource(
          series,
          result,
          history.provider,
          history.metric === "sold"
            ? "Выкупы — отдельно от заказов"
            : "Возвраты — отдельно от заказов",
        ),
      );
    }
    const sku = input.skus.find((s) => s.id === row.skuId)!;
    row.targetUnits = Math.max(
      Math.ceil(demand),
      policy.minimumBoxes * sku.unitsPerBox,
    );
    row.seasonalityApplied = seasonal > 0;
    row.methodLabel = seasonal
      ? "Прогноз с сезонностью"
      : learned
        ? "Обучаемая модель спроса"
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
    row.message = seasonal
      ? "Сезонная модель проверена на прошлом и учитывает текущую динамику продаж."
      : learned
        ? "Обучаемая модель проверена по прошлым заказам и улучшила прогноз недавнего спроса."
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
  return {
    key: input.key,
    generatedAt: input.generatedAt,
    overview,
    goals,
    modelVersion: FORECAST_MODEL_VERSION,
    fingerprints,
  };
}
