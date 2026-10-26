import { createHash } from "node:crypto";
import type {
  ForecastCandidate,
  ForecastDailyValue,
  ForecastHistoryCoverage,
  ForecastHorizonMetrics,
  ForecastMetrics,
  ForecastModel,
  ForecastOptions,
  ForecastPoint,
  ForecastResult,
  ForecastSeries,
} from "./engine-types";

export type * from "./engine-types";

export const FORECAST_MODEL_VERSION = "seasonal-v1.0.0";
const DAY = 86_400_000;
const MODELS: ForecastModel[] = [
  "mean",
  "annual_seasonal",
  "annual_growth",
  "ridge",
];
const MIN_ANNUAL_OBSERVATIONS = 400;
const MIN_COVERAGE = 0.8;
const MIN_IMPROVEMENT = 0.05;
const MAX_FOLDS_PER_HORIZON = 3;

interface Observation {
  day: number;
  units: number;
}
interface Prepared {
  points: ForecastPoint[];
  values: Observation[];
  byDay: Map<number, number>;
  first: number | null;
  asOf: number;
  coverage: ForecastHistoryCoverage;
}
interface Fit {
  values: number[] | null;
  reason: string | null;
}
interface Fold {
  horizon: number;
  absolute: number;
  signed: number;
  actual: number;
  observations: number;
  baselineAbsolute: number;
}

const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const dateString = (day: number) =>
  new Date(day * DAY).toISOString().slice(0, 10);

function parseDay(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Forecast dates must use YYYY-MM-DD");
  const stamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(stamp) ||
    new Date(stamp).toISOString().slice(0, 10) !== value
  )
    throw new Error("Forecast date is invalid");
  return stamp / DAY;
}

function prepare(series: ForecastSeries, asOf: number): Prepared {
  for (const key of [
    "id",
    "provider",
    "storeId",
    "externalId",
    "metric",
  ] as const)
    if (typeof series[key] !== "string" || !series[key].trim())
      throw new Error(`Forecast series requires ${key}`);
  if (!Array.isArray(series.points) || series.points.length > 30_000)
    throw new Error("Forecast series size is invalid");
  const points: ForecastPoint[] = [];
  const seen = new Set<number>();
  for (const point of series.points) {
    const day = parseDay(point.date);
    if (day > asOf) continue;
    if (seen.has(day)) throw new Error("Forecast contains duplicate dates");
    seen.add(day);
    if (
      point.units !== null &&
      (!Number.isFinite(point.units) ||
        point.units < 0 ||
        point.units > 1_000_000_000)
    )
      throw new Error("Forecast units must be nonnegative finite quantities");
    if (!["available", "out_of_stock", "unknown"].includes(point.availability))
      throw new Error("Forecast availability is invalid");
    points.push({
      date: point.date,
      units: point.units,
      availability: point.availability,
    });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  const first = points.length ? parseDay(points[0].date) : null;
  const calendarDays = first === null ? 0 : asOf - first + 1;
  if (calendarDays > 30_000)
    throw new Error("Forecast date range is too large");
  const values: Observation[] = [];
  let stockoutDays = 0;
  let availableDays = 0;
  let unknownAvailabilityDays = 0;
  for (const point of points) {
    if (point.availability === "out_of_stock") {
      stockoutDays++;
      continue;
    }
    if (point.units === null) continue;
    values.push({ day: parseDay(point.date), units: point.units });
    if (point.availability === "available") availableDays++;
    else unknownAvailabilityDays++;
  }
  return {
    points,
    values,
    byDay: new Map(values.map((p) => [p.day, p.units])),
    first,
    asOf,
    coverage: {
      from: first === null ? null : dateString(first),
      to: dateString(asOf),
      calendarDays,
      knownDays: values.length,
      missingDays: calendarDays - values.length - stockoutDays,
      stockoutDays,
      availableDays,
      unknownAvailabilityDays,
      coverageRatio: calendarDays ? rounded(values.length / calendarDays) : 0,
    },
  };
}

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const clamp = (value: number, lower: number, upper: number) =>
  Math.max(lower, Math.min(upper, value));

function quantile(values: number[], probability: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  return (
    sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower)
  );
}

function trimmedMean(values: number[]): number {
  if (values.length < 10) return mean(values);
  const sorted = [...values].sort((a, b) => a - b);
  const trim = Math.floor(values.length * 0.1);
  return mean(sorted.slice(trim, sorted.length - trim));
}

/** Calendar anniversary, not a 365-day offset; Feb 29 maps to Feb 28. */
function previousYear(day: number): number {
  const current = new Date(day * DAY);
  const year = current.getUTCFullYear() - 1;
  const month = current.getUTCMonth();
  const date = current.getUTCDate();
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(date, last)) / DAY;
}

function nearbyMean(
  byDay: Map<number, number>,
  day: number,
  radius = 3,
): number | null {
  const window: number[] = [];
  for (let offset = -radius; offset <= radius; offset++) {
    const value = byDay.get(day + offset);
    if (value !== undefined) window.push(value);
  }
  return window.length >= 4 ? trimmedMean(window) : null;
}

function annualReason(values: Observation[], asOf: number): string | null {
  if (values.length < MIN_ANNUAL_OBSERVATIONS || asOf - values[0].day + 1 < 400)
    return "Для годовой сезонности нужно не менее 400 известных дней истории.";
  const recent = values.filter((p) => p.day > asOf - 365);
  if (recent.length / 365 < MIN_COVERAGE)
    return "В последнем годе слишком много пропусков или дней без товара.";
  return null;
}

function calendarFeatures(day: number, origin: number): number[] {
  const date = new Date(day * DAY);
  const start = Date.UTC(date.getUTCFullYear(), 0, 1) / DAY;
  const end = Date.UTC(date.getUTCFullYear() + 1, 0, 1) / DAY;
  const phase = (day - start) / (end - start);
  const features = [1, (day - origin) / 365];
  for (let harmonic = 1; harmonic <= 4; harmonic++) {
    features.push(Math.sin(2 * Math.PI * harmonic * phase));
    features.push(Math.cos(2 * Math.PI * harmonic * phase));
  }
  // Weekly effects and annual effects are learned in the same fit.
  for (let weekday = 1; weekday <= 6; weekday++)
    features.push(date.getUTCDay() === weekday ? 1 : 0);
  return features;
}

/** Small ridge fit; pivoted elimination, unpenalized intercept. No external runtime. */
function ridgeCoefficients(
  rows: number[][],
  targets: number[],
): number[] | null {
  const width = rows[0].length;
  const matrix = Array.from(
    { length: width },
    () => Array(width + 1).fill(0) as number[],
  );
  for (let r = 0; r < rows.length; r++) {
    for (let i = 0; i < width; i++) {
      matrix[i][width] += rows[r][i] * targets[r];
      for (let j = 0; j < width; j++) matrix[i][j] += rows[r][i] * rows[r][j];
    }
  }
  for (let i = 1; i < width; i++) matrix[i][i] += 5;
  for (let pivot = 0; pivot < width; pivot++) {
    let best = pivot;
    for (let row = pivot + 1; row < width; row++)
      if (Math.abs(matrix[row][pivot]) > Math.abs(matrix[best][pivot]))
        best = row;
    [matrix[pivot], matrix[best]] = [matrix[best], matrix[pivot]];
    if (Math.abs(matrix[pivot][pivot]) < 1e-10) return null;
    const divisor = matrix[pivot][pivot];
    for (let column = pivot; column <= width; column++)
      matrix[pivot][column] /= divisor;
    for (let row = 0; row < width; row++) {
      if (row === pivot) continue;
      const factor = matrix[row][pivot];
      for (let column = pivot; column <= width; column++)
        matrix[row][column] -= factor * matrix[pivot][column];
    }
  }
  const result = matrix.map((row) => row[width]);
  return result.every(Number.isFinite) ? result : null;
}

function dot(features: number[], coefficients: number[]): number {
  return features.reduce(
    (sum, feature, i) => sum + feature * coefficients[i],
    0,
  );
}

function fit(
  model: ForecastModel,
  values: Observation[],
  asOf: number,
  horizon: number,
  baselineHistoryDays: number,
): Fit {
  const recent = values.filter((p) => p.day > asOf - baselineHistoryDays);
  const baseline = mean(recent.map((p) => p.units));
  if (model === "mean")
    return {
      values: Array(horizon).fill(baseline) as number[],
      reason: null,
    };
  const reason = annualReason(values, asOf);
  if (reason) return { values: null, reason };
  const byDay = new Map(values.map((p) => [p.day, p.units]));
  const cap = Math.max(
    1,
    quantile(
      values.map((p) => p.units),
      0.98,
    ) * 4,
    baseline * 4,
  );
  if (model === "annual_seasonal" || model === "annual_growth") {
    const shape: (number | null)[] = [];
    for (let offset = 1; offset <= horizon; offset++)
      shape.push(nearbyMean(byDay, previousYear(asOf + offset)));
    if (shape.filter((p) => p !== null).length / horizon < MIN_COVERAGE)
      return {
        values: null,
        reason: "Не хватает прошлогодних наблюдений для нужных недель.",
      };
    let growth = 1;
    if (model === "annual_growth") {
      const now: number[] = [];
      const before: number[] = [];
      for (const point of values.filter((p) => p.day > asOf - 56)) {
        const historic = nearbyMean(byDay, previousYear(point.day));
        if (historic !== null) {
          now.push(point.units);
          before.push(historic);
        }
      }
      if (now.length < 35 || trimmedMean(before) <= 0)
        return {
          values: null,
          reason: "Не хватает сопоставимых дней для поправки на текущий год.",
        };
      // Matched calendar dates already contain the seasonal shape. Apply growth once.
      growth = clamp(trimmedMean(now) / trimmedMean(before), 1 / 3, 3);
    }
    return {
      values: shape.map((value, index) => {
        // The growth correction approaches 1 on distant horizons instead of exploding.
        const damped = Math.exp(Math.log(growth) * Math.exp(-index / 180));
        return clamp((value ?? baseline) * damped, 0, cap);
      }),
      reason: null,
    };
  }
  const train = values.filter((p) => p.day > asOf - 730);
  const origin = train[0].day;
  const rows = train.map((p) => calendarFeatures(p.day, origin));
  const coefficients = ridgeCoefficients(
    rows,
    train.map((p) => Math.log1p(p.units)),
  );
  if (!coefficients)
    return { values: null, reason: "Модель не удалось устойчиво обучить." };
  // Training-only smearing correction counteracts the log transform's downward bias.
  const smear = clamp(
    mean(
      train.map((p, i) =>
        Math.exp(
          clamp(Math.log1p(p.units) - dot(rows[i], coefficients), -5, 5),
        ),
      ),
    ),
    0.5,
    2,
  );
  return {
    values: Array.from({ length: horizon }, (_, index) => {
      const features = calendarFeatures(asOf + index + 1, origin);
      // Dampen only extrapolated trend; historical trend is unchanged during fitting.
      features[1] =
        (asOf - origin + 180 * (1 - Math.exp(-(index + 1) / 180))) / 365;
      return clamp(
        Math.exp(clamp(dot(features, coefficients), -20, 20)) * smear - 1,
        0,
        cap,
      );
    }),
    reason: null,
  };
}

function foldMetrics(folds: Fold[]): ForecastMetrics | null {
  if (!folds.length) return null;
  const aggregate = (group: Fold[]) => {
    const observations = group.reduce((sum, f) => sum + f.observations, 0);
    const absolute = group.reduce((sum, f) => sum + f.absolute, 0);
    const actual = group.reduce((sum, f) => sum + f.actual, 0);
    return {
      mae: rounded(absolute / observations),
      wape: actual ? rounded(absolute / actual) : null,
      bias: rounded(group.reduce((sum, f) => sum + f.signed, 0) / observations),
      folds: group.length,
      observations,
    };
  };
  const aggregateAll = aggregate(folds);
  const baseline = folds.reduce((sum, f) => sum + f.baselineAbsolute, 0);
  const absolute = folds.reduce((sum, f) => sum + f.absolute, 0);
  const byHorizon: ForecastHorizonMetrics[] = [
    ...new Set(folds.map((f) => f.horizon)),
  ]
    .sort((a, b) => a - b)
    .map((horizonDays) => ({
      horizonDays,
      ...aggregate(folds.filter((f) => f.horizon === horizonDays)),
    }));
  return {
    ...aggregateAll,
    byHorizon,
    baselineImprovement: baseline > 0 ? rounded(1 - absolute / baseline) : null,
    winRate: rounded(
      folds.filter((f) => f.absolute < f.baselineAbsolute * 0.95).length /
        folds.length,
    ),
  };
}

function backtest(
  prepared: Prepared,
  horizon: number,
  baselineHistoryDays: number,
): Map<ForecastModel, Fold[]> {
  const results = new Map<ForecastModel, Fold[]>(
    MODELS.map((model) => [model, []]),
  );
  const horizons = [...new Set([7, 28, horizon])].sort((a, b) => a - b);
  for (const validationDays of horizons) {
    // Three nonoverlapping validation windows at each horizon, no random shuffle.
    for (let fold = 0; fold < MAX_FOLDS_PER_HORIZON; fold++) {
      const cutoff = prepared.asOf - validationDays * (fold + 1);
      const prefix = prepared.values.filter((p) => p.day <= cutoff);
      if (
        prefix.filter((p) => p.day > cutoff - baselineHistoryDays).length <
        Math.min(28, baselineHistoryDays)
      )
        continue;
      const actual = prepared.values.filter(
        (p) => p.day > cutoff && p.day <= cutoff + validationDays,
      );
      if (actual.length / validationDays < MIN_COVERAGE) continue;
      const baseline = fit(
        "mean",
        prefix,
        cutoff,
        validationDays,
        baselineHistoryDays,
      ).values!;
      let baselineAbsolute = 0;
      for (const point of actual)
        baselineAbsolute += Math.abs(
          baseline[point.day - cutoff - 1] - point.units,
        );
      for (const model of MODELS) {
        const fitted =
          model === "mean"
            ? baseline
            : fit(model, prefix, cutoff, validationDays, baselineHistoryDays)
                .values;
        if (!fitted) continue;
        let absolute = 0;
        let signed = 0;
        for (const point of actual) {
          const error = fitted[point.day - cutoff - 1] - point.units;
          absolute += Math.abs(error);
          signed += error;
        }
        results.get(model)!.push({
          horizon: validationDays,
          absolute,
          signed,
          actual: actual.reduce((sum, p) => sum + p.units, 0),
          observations: actual.length,
          baselineAbsolute,
        });
      }
    }
  }
  return results;
}

function selectionReason(
  model: ForecastModel,
  fitted: Fit,
  folds: Fold[],
  horizon: number,
): string | null {
  if (fitted.reason) return fitted.reason;
  if (model === "mean") return null;
  const working = folds.filter((f) => f.horizon === horizon);
  if (working.length < 3)
    return "Пока нет трёх полных проверок на прошлом для выбранного горизонта.";
  const metrics = foldMetrics(folds)!;
  if (
    metrics.baselineImprovement === null ||
    metrics.baselineImprovement < MIN_IMPROVEMENT
  )
    return "На проверке модель не улучшила средний спрос хотя бы на 5%.";
  // Flat periods may be exact ties. They are neutral, not failed seasonal tests.
  const stable = (group: Fold[]) =>
    group.filter((f) => f.absolute <= f.baselineAbsolute * 1.05 + 1e-8).length /
      group.length >=
    2 / 3;
  if (!stable(folds) || !stable(working))
    return "Улучшение неустойчиво между проверочными периодами.";
  const workingMetrics = foldMetrics(working)!;
  if (
    workingMetrics.baselineImprovement === null ||
    workingMetrics.baselineImprovement < MIN_IMPROVEMENT
  )
    return "На рабочем горизонте модель не улучшила средний спрос хотя бы на 5%.";
  // A single lucky window cannot establish skill. The gain must survive removing
  // the strongest fold as well (horizons are disclosed separately in the result).
  const strongest = [...folds].sort(
    (a, b) =>
      b.baselineAbsolute - b.absolute - (a.baselineAbsolute - a.absolute),
  )[0];
  const withoutStrongest = foldMetrics(folds.filter((f) => f !== strongest));
  if (
    !withoutStrongest ||
    withoutStrongest.baselineImprovement === null ||
    withoutStrongest.baselineImprovement < MIN_IMPROVEMENT
  )
    return "Улучшение зависит от одного проверочного периода.";
  // One lucky large seasonal window must not compensate for a badly biased forecast.
  const absolute = folds.reduce((sum, f) => sum + f.absolute, 0);
  const signed = folds.reduce((sum, f) => sum + f.signed, 0);
  const baselineAbsolute = folds.reduce(
    (sum, f) => sum + f.baselineAbsolute,
    0,
  );
  if (Math.abs(signed) > baselineAbsolute * 0.8 || !Number.isFinite(absolute))
    return "Систематическое завышение или занижение прогноза слишком велико.";
  return null;
}

/** Pure, deterministic daily-demand forecast. Never creates stock, tasks or network traffic. */
export function runForecast(
  series: ForecastSeries,
  options: ForecastOptions,
): ForecastResult {
  const asOf = parseDay(options.asOf);
  const baselineHistoryDays = options.baselineHistoryDays ?? 56;
  if (
    !Number.isInteger(baselineHistoryDays) ||
    baselineHistoryDays < 1 ||
    baselineHistoryDays > 89
  )
    throw new Error("Forecast baseline window must be between 1 and 89 days");
  if (
    !Number.isInteger(options.horizonDays) ||
    options.horizonDays < 1 ||
    options.horizonDays > 330
  )
    throw new Error("Forecast horizon must be between 1 and 330 days");
  if (
    options.minUnits !== undefined &&
    (!Number.isFinite(options.minUnits) ||
      options.minUnits < 0 ||
      options.minUnits > 1_000_000_000)
  )
    throw new Error("Forecast minimum must be a nonnegative finite quantity");
  const prepared = prepare(series, asOf);
  const folds = backtest(prepared, options.horizonDays, baselineHistoryDays);
  const fitted = new Map(
    MODELS.map((model) => [
      model,
      fit(
        model,
        prepared.values,
        asOf,
        options.horizonDays,
        baselineHistoryDays,
      ),
    ]),
  );
  const candidates: ForecastCandidate[] = MODELS.map((model) => {
    const reason = selectionReason(
      model,
      fitted.get(model)!,
      folds.get(model)!,
      options.horizonDays,
    );
    return {
      model,
      eligible: reason === null,
      reason,
      metrics: foldMetrics(folds.get(model)!),
    };
  });
  // All advanced candidates are evaluated against the baseline on matching folds.
  const advanced = candidates.filter((c) => c.model !== "mean" && c.eligible);
  advanced.sort((a, b) => {
    const error = (candidate: ForecastCandidate) =>
      candidate.metrics!.byHorizon.find(
        (h) => h.horizonDays === options.horizonDays,
      )!.mae;
    return (
      error(a) - error(b) || MODELS.indexOf(a.model) - MODELS.indexOf(b.model)
    );
  });
  const selectedModel = advanced[0]?.model ?? "mean";
  const dailyForecast: ForecastDailyValue[] = fitted
    .get(selectedModel)!
    .values!.map((units, index) => ({
      date: dateString(asOf + index + 1),
      units: rounded(units),
    }));
  const rawTotal = rounded(
    dailyForecast.reduce((sum, point) => sum + point.units, 0),
  );
  const coverage = prepared.coverage;
  const selectedMetrics = candidates.find(
    (c) => c.model === selectedModel,
  )!.metrics;
  const confidence =
    coverage.knownDays >= 1095 &&
    coverage.coverageRatio >= 0.95 &&
    coverage.unknownAvailabilityDays / coverage.knownDays < 0.1 &&
    selectedMetrics?.wape !== null &&
    (selectedMetrics?.wape ?? 1) < 0.25
      ? "high"
      : coverage.knownDays >= 600 && coverage.coverageRatio >= 0.8
        ? "medium"
        : "low";
  let fallbackReason: string | null = null;
  if (selectedModel === "mean") {
    fallbackReason =
      annualReason(prepared.values, asOf) ??
      "Сезонные модели пока не показали устойчивого улучшения на прошлом; используется средний спрос.";
    if (!prepared.values.some((p) => p.day > asOf - baselineHistoryDays))
      fallbackReason = `За последние ${baselineHistoryDays} дней нет известных наблюдений спроса; прогноз нельзя считать подтверждённым.`;
  }
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        version: FORECAST_MODEL_VERSION,
        series: {
          id: series.id,
          provider: series.provider,
          storeId: series.storeId,
          externalId: series.externalId,
          metric: series.metric,
          points: prepared.points,
        },
        asOf: options.asOf,
        horizonDays: options.horizonDays,
        baselineHistoryDays,
        minUnits: options.minUnits ?? 0,
      }),
    )
    .digest("hex");
  return {
    dailyForecast,
    totalUnits: Math.max(rawTotal, options.minUnits ?? 0),
    selectedModel,
    confidence,
    candidates,
    historyCoverage: coverage,
    fallbackReason,
    fingerprint,
    modelVersion: FORECAST_MODEL_VERSION,
  };
}
