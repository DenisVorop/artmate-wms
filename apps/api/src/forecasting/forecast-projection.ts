import type { SkuDto } from "../dto";
import type { MarketplaceState } from "../marketplaces/storage";
import type {
  MarketplaceProvider,
  MarketplaceSnapshot,
} from "../marketplaces/providers/types";
import type { ForecastHistorySeries } from "./history-types";
import { runForecast, FORECAST_MODEL_VERSION } from "./engine";
import { calibrateFinancialSeason } from "./forecast-calibration";
import type {
  ForecastModel,
  ForecastResult,
  ForecastSeries,
} from "./engine-types";
import type {
  ForecastCache,
  ForecastPlanGoal,
  ForecastPolicy,
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
function baselineContribution(
  input: ForecastComputeInput,
  provider: MarketplaceProvider,
  externalId: string,
): number {
  const mapping = input.mappings.find(
    (m) => m.provider === provider && m.externalId === externalId,
  );
  const snapshot = input.snapshots.find((s) => s.provider === provider);
  const from = new Date(
    Date.parse(input.asOf) - 86_400_000 * (input.settings.historyDays - 1),
  )
    .toISOString()
    .slice(0, 10);
  const ordered = (snapshot?.demand ?? [])
    .filter(
      (d) =>
        d.externalId === externalId && d.date >= from && d.date <= input.asOf,
    )
    .reduce(
      (n, d) =>
        n +
        Math.max(0, d.orderedUnits - d.cancelledUnits) *
          (mapping?.unitsPerItem ?? 1),
      0,
    );
  return (
    (ordered / input.settings.historyDays) *
    (input.settings.horizonDays +
      input.settings.safetyDays +
      input.settings.leadDays)
  );
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
  const horizon =
    input.settings.horizonDays +
    input.settings.safetyDays +
    input.settings.leadDays;
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
      seasonal = 0;
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
      const baseline = baselineContribution(
        input,
        mapping.provider,
        mapping.externalId,
      );
      if (!ordered) {
        demand += baseline;
        confidences.push("low");
        continue;
      }
      const series = netSeries(ordered, cancelled),
        result = runForecast(series, {
          asOf: input.asOf,
          horizonDays: horizon,
          baselineHistoryDays: input.settings.historyDays,
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
      if (useSeasonal) seasonal++;
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
        source.modelLabel = "Средний спрос";
        // Keep displayed forecast consistent with the exact legacy mean used by the planner.
        const average = baseline / horizon;
        source.points = source.points.map((p) =>
          p.predicted !== null ? { ...p, predicted: average } : p,
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
    row.methodLabel = seasonal ? "Прогноз с сезонностью" : "Средний спрос";
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
      : !policy.seasonalityEnabled
        ? "Сезонность отключена. Используется средний спрос."
        : related.length
          ? "Годовая сезонность пока не подтверждена; используется текущий средний спрос."
          : "Свяжите тематику с товарами маркетплейсов.";
  }
  overview.ready = true;
  overview.computing = false;
  overview.generatedAt = input.generatedAt;
  overview.message = overview.rows.some((r) => r.seasonalityApplied)
    ? "Прогноз учитывает проверенную сезонность. Остатки и поставки вычитаются в плане сборки."
    : "Сезонность ещё проверяется на истории. Пока используется текущий средний спрос.";
  const goals: Record<string, ForecastPlanGoal> = Object.fromEntries(
    overview.rows.map((r) => [
      r.skuId,
      {
        targetUnits: r.targetUnits,
        methodLabel: r.methodLabel,
        confidenceLabel: r.confidenceLabel,
        message: r.message,
        seasonalityApplied: r.seasonalityApplied,
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
