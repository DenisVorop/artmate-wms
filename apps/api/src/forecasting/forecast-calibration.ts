import { createHash } from "node:crypto";
import {
  fitUnvalidatedAnnualForecast,
  fitUnvalidatedCalendarForecast,
  runForecast,
} from "./engine";
import type { ForecastSeries, ForecastDailyValue } from "./engine-types";
import type { ForecastCandidateDto } from "./forecast-dto";
import { baselineFromObservations } from "./demand-baseline";
import { newYearScenarioFromObservations } from "./new-year-scenario";

const DAY = 86_400_000;
const MODEL = "financial_calibrated";
const LABEL = "Сезон выкупов с проверкой по заказам";
const VERSION = "financial-calibration-v1";
type Observation = { day: number; units: number };
type CalibrationMethod = "annual_shape" | "calendar_ml";
interface CalibrationFit {
  values: number[] | null;
  reason: string | null;
}
export interface FinancialCalibration {
  candidate: ForecastCandidateDto;
  dailyForecast: ForecastDailyValue[];
  totalUnits: number;
  fingerprint: string;
  message?: string;
  /** A financial seasonal test is not a long-horizon order backtest. */
  seasonalityKnown?: boolean;
  scenario?: boolean;
  financialValidation?: {
    model: string;
    horizonDays: number;
    folds: number;
    wape: number | null;
  };
  bridgeValidation?: {
    horizonDays: number[];
    folds: number;
    observedDays: number;
    wape: number | null;
  };
}
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
function trimmed(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b),
    n = values.length >= 10 ? Math.floor(values.length * 0.1) : 0;
  return mean(sorted.slice(n, sorted.length - n));
}
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n * 1e6) / 1e6;
function lastYear(day: number) {
  const d = new Date(day * DAY),
    year = d.getUTCFullYear() - 1,
    month = d.getUTCMonth();
  return (
    Date.UTC(
      year,
      month,
      Math.min(
        d.getUTCDate(),
        new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
      ),
    ) / DAY
  );
}
function observed(series: ForecastSeries, asOf: number): Observation[] {
  return series.points
    .filter(
      (p) =>
        p.units !== null &&
        p.availability !== "out_of_stock" &&
        Date.parse(p.date) / DAY <= asOf,
    )
    .map((p) => ({ day: Date.parse(p.date) / DAY, units: p.units! }))
    .sort((a, b) => a.day - b.day);
}
function nearby(byDay: Map<number, number>, day: number) {
  const values: number[] = [];
  for (let offset = -7; offset <= 7; offset++) {
    const n = byDay.get(day + offset);
    if (n !== undefined) values.push(n);
  }
  return values.length >= 8 ? trimmed(values) : null;
}
function fit(
  op: Observation[],
  financial: Observation[],
  asOf: number,
  horizon: number,
): CalibrationFit {
  if (
    financial.length < 400 ||
    financial.filter((p) => p.day > asOf - 365).length / 365 < 0.8
  )
    return {
      values: null,
      reason:
        "Для сезонной формы выкупов не хватает полного года известных наблюдений.",
    };
  const recent = op.filter((p) => p.day > asOf - 56);
  if (recent.length < 56)
    return {
      values: null,
      reason: "Для калибровки нужны 56 известных дней заказов без пропусков.",
    };
  const byDay = new Map(financial.map((p) => [p.day, p.units]));
  const paired = recent.flatMap((p) => {
    const f = byDay.get(p.day);
    return f === undefined
      ? []
      : [
          {
            operational: p.units,
            financial: f,
            previous: nearby(byDay, lastYear(p.day)),
          },
        ];
  });
  const comparable = paired.filter((p) => p.previous !== null);
  if (paired.length < 28 || comparable.length < 28)
    return {
      values: null,
      reason:
        "Нужно не менее 28 сопоставимых дней заказов и выкупов с известной прошлогодней формой.",
    };
  const financialLevel = trimmed(comparable.map((p) => p.financial));
  const lastYearLevel = trimmed(comparable.map((p) => p.previous!));
  if (financialLevel <= 0 || lastYearLevel <= 0)
    return {
      values: null,
      reason:
        "Недостаточно ненулевого спроса для калибровки разных показателей.",
    };
  const bridge = clamp(
    trimmed(comparable.map((p) => p.operational)) / financialLevel,
    0.25,
    4,
  );
  const growth = clamp(financialLevel / lastYearLevel, 1 / 3, 3);
  const shapes = Array.from({ length: horizon }, (_, i) =>
    nearby(byDay, lastYear(asOf + i + 1)),
  );
  if (shapes.filter((n) => n !== null).length / horizon < 0.8)
    return {
      values: null,
      reason: "Не хватает прошлогодних выкупов для будущих недель.",
    };
  const baseline = mean(recent.map((p) => p.units)),
    sorted = op.map((p) => p.units).sort((a, b) => a - b);
  const cap = Math.max(
    1,
    baseline * 4,
    sorted[Math.floor((sorted.length - 1) * 0.98)] * 4,
  );
  return {
    values: shapes.map((n, i) =>
      clamp(
        n === null
          ? baseline
          : n * bridge * Math.exp(Math.log(growth) * Math.exp(-i / 180)),
        0,
        cap,
      ),
    ),
    reason: null,
  };
}
/** Explicit cross-metric calibration. Only operational holdouts may authorize use in planning. */
export function calibrateFinancialSeason(
  operational: ForecastSeries,
  financial: ForecastSeries,
  asOf: string,
  horizon: number,
  baselineHistoryDays = 56,
  useNewYearScenario = false,
  method: CalibrationMethod = "annual_shape",
): FinancialCalibration {
  if (
    operational.provider !== financial.provider ||
    operational.storeId !== financial.storeId ||
    operational.externalId !== financial.externalId
  )
    throw new Error(
      "Financial calibration requires the same store and product",
    );
  const end = Date.parse(asOf) / DAY,
    op = observed(operational, end),
    fin = observed(financial, end);
  const trainedFit = (
    prefix: Observation[],
    financialPrefix: Observation[],
    cutoff: number,
    days: number,
  ): CalibrationFit => {
    if (method === "annual_shape")
      return fit(prefix, financialPrefix, cutoff, days);
    const recent = prefix.filter((p) => p.day > cutoff - 56);
    const financialByDay = new Map(
      financialPrefix.map((p) => [p.day, p.units]),
    );
    const paired = recent.flatMap((p) => {
      const sold = financialByDay.get(p.day);
      return sold === undefined ? [] : [{ ordered: p.units, sold }];
    });
    // No numerical conversion is assumed from finance to orders. Learn it only
    // from actual contemporaneous observations, never from a future holdout.
    if (paired.length < 28)
      return {
        values: null,
        reason:
          "Для связи выкупов и заказов нужны 28 совместных известных дней за последние 56 дней.",
      };
    const soldLevel = trimmed(paired.map((p) => p.sold));
    if (soldLevel <= 0)
      return {
        values: null,
        reason: "Недостаточно ненулевых выкупов для связи с заказами.",
      };
    const bridge = clamp(
      trimmed(paired.map((p) => p.ordered)) / soldLevel,
      0.25,
      4,
    );
    const trained = fitUnvalidatedCalendarForecast(
      financial,
      new Date(cutoff * DAY).toISOString().slice(0, 10),
      days,
      baselineHistoryDays,
    );
    return {
      values: trained.reason
        ? null
        : trained.dailyForecast.map((p) => p.units * bridge),
      reason: trained.reason,
    };
  };
  const current = trainedFit(op, fin, end, horizon);
  const folds: {
    horizon: number;
    absolute: number;
    signed: number;
    actual: number;
    count: number;
    baseline: number;
  }[] = [];
  for (const h of [...new Set([7, 28, horizon])])
    for (let n = 0; n < 3; n++) {
      const cutoff = end - h * (n + 1),
        prefix = op.filter((p) => p.day <= cutoff),
        financialPrefix = fin.filter((p) => p.day <= cutoff);
      const fitted = trainedFit(prefix, financialPrefix, cutoff, h);
      if (!fitted.values) continue;
      const actual = op.filter((p) => p.day > cutoff && p.day <= cutoff + h);
      if (actual.length / h < 0.8) continue;
      const baseline = useNewYearScenario
        ? newYearScenarioFromObservations(
            prefix,
            cutoff,
            h,
            baselineHistoryDays,
          ).dailyForecast
        : baselineFromObservations(prefix, cutoff, h, baselineHistoryDays)
            .dailyForecast;
      let absolute = 0,
        signed = 0,
        baselineError = 0;
      for (const p of actual) {
        const error = fitted.values[p.day - cutoff - 1] - p.units;
        absolute += Math.abs(error);
        signed += error;
        baselineError += Math.abs(baseline[p.day - cutoff - 1].units - p.units);
      }
      folds.push({
        horizon: h,
        absolute,
        signed,
        actual: actual.reduce((sum, p) => sum + p.units, 0),
        count: actual.length,
        baseline: baselineError,
      });
    }
  const absolute = folds.reduce((n, f) => n + f.absolute, 0),
    signed = folds.reduce((n, f) => n + f.signed, 0),
    actual = folds.reduce((n, f) => n + f.actual, 0),
    count = folds.reduce((n, f) => n + f.count, 0),
    baseline = folds.reduce((n, f) => n + f.baseline, 0);
  const working = folds.filter((f) => f.horizon === horizon);
  let reason = current.reason;
  if (!reason && working.length < 3)
    reason =
      "Пока нет трёх проверок сезонной формы выкупов на фактических заказах для выбранного горизонта.";
  if (!reason && (baseline <= 0 || absolute > baseline * 0.95))
    reason =
      "Калибровка выкупов пока не улучшила прогноз заказов хотя бы на 5%.";
  if (
    !reason &&
    working.filter((f) => f.absolute <= f.baseline * 1.05 + 1e-8).length /
      working.length <
      2 / 3
  )
    reason = "Поправка между выкупами и заказами неустойчива между периодами.";
  const best = [...folds].sort(
    (a, b) => b.baseline - b.absolute - (a.baseline - a.absolute),
  )[0];
  const restBaseline = baseline - (best?.baseline ?? 0),
    restAbsolute = absolute - (best?.absolute ?? 0);
  if (!reason && (restBaseline <= 0 || restAbsolute > restBaseline * 0.95))
    reason = "Улучшение калибровки зависит от одного периода.";
  const workBaseline = working.reduce((n, f) => n + f.baseline, 0),
    workAbsolute = working.reduce((n, f) => n + f.absolute, 0);
  if (
    !reason &&
    (workBaseline <= 0 ||
      workAbsolute > workBaseline * 0.95 ||
      Math.abs(signed) > baseline * 0.8)
  )
    reason = "Калибровка не подтверждена на рабочем горизонте.";
  const dailyForecast = (current.values ?? []).map((units, i) => ({
    date: new Date((end + i + 1) * DAY).toISOString().slice(0, 10),
    units: round(units),
  }));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        version: VERSION,
        method,
        asOf,
        horizon,
        baselineHistoryDays,
        useNewYearScenario,
        operationalMetric: operational.metric,
        financialMetric: financial.metric,
        operational: op,
        financial: fin,
        store: operational.storeId,
        externalId: operational.externalId,
        provider: operational.provider,
      }),
    )
    .digest("hex");
  return {
    candidate: {
      model: method === "calendar_ml" ? "financial_calendar_ml" : MODEL,
      label:
        method === "calendar_ml"
          ? "ML: календарь выкупов с проверкой по заказам"
          : LABEL,
      eligible: reason === null,
      reason,
      mae: count ? round(absolute / count) : null,
      wape: actual ? round(absolute / actual) : null,
      bias: count ? round(signed / count) : null,
      folds: folds.length,
    },
    dailyForecast,
    totalUnits: round(dailyForecast.reduce((n, p) => n + p.units, 0)),
    fingerprint,
  };
}

/** Full-history calendar ML is a separate candidate; financial units are never
 * added to orders. All calendar fitting and conversion ratios are prefix-only.
 */
export function calibrateFinancialCalendarMl(
  operational: ForecastSeries,
  financial: ForecastSeries,
  asOf: string,
  horizon: number,
  baselineHistoryDays = 56,
  useNewYearScenario = false,
): FinancialCalibration {
  return calibrateFinancialSeason(
    operational,
    financial,
    asOf,
    horizon,
    baselineHistoryDays,
    useNewYearScenario,
    "calendar_ml",
  );
}

/** Learned cross-metric relationship. Ratios use only contemporaneous known
 * days, with recent demand receiving more weight. Financial units never enter
 * the operational series as observations. */
function conversion(
  op: Observation[],
  financial: Observation[],
  cutoff: number,
): { ratio: number | null; reason: string | null } {
  const sold = new Map(financial.map((p) => [p.day, p.units]));
  const paired = op.flatMap((p) => {
    const value = sold.get(p.day);
    return p.day > cutoff - 56 && value !== undefined
      ? [{ day: p.day, ordered: p.units, sold: value }]
      : [];
  });
  if (paired.length < 28)
    return {
      ratio: null,
      reason: "Для связи выкупов и заказов нужны 28 совместных известных дней.",
    };
  let soldTotal = 0,
    orderedTotal = 0;
  for (const p of paired) {
    const weight = Math.exp((-Math.LN2 * (cutoff - p.day)) / 28);
    soldTotal += p.sold * weight;
    orderedTotal += p.ordered * weight;
  }
  if (soldTotal <= 0 || orderedTotal <= 0)
    return {
      ratio: null,
      reason: "Недостаточно ненулевых выкупов и заказов для связи показателей.",
    };
  const ratio = orderedTotal / soldTotal;
  if (!Number.isFinite(ratio) || ratio < 0.25 || ratio > 4)
    return {
      ratio: null,
      reason: "Соотношение заказов и выкупов требует проверки единиц учёта.",
    };
  return { ratio, reason: null };
}

function assertFinancialBridgeIdentity(
  operational: ForecastSeries,
  financial: ForecastSeries,
) {
  for (const key of ["provider", "storeId", "externalId"] as const)
    if (
      typeof operational[key] !== "string" ||
      !operational[key].trim() ||
      typeof financial[key] !== "string" ||
      !financial[key].trim()
    )
      throw new Error(
        "Financial bridge requires a nonempty store and product identity",
      );
  if (
    operational.provider !== financial.provider ||
    operational.storeId !== financial.storeId ||
    operational.externalId !== financial.externalId
  )
    throw new Error(
      "Financial calibration requires the same store and product",
    );
  if (
    operational.metric !== "net_ordered" ||
    !["financial_gross_sold", "net_financial_sold"].includes(financial.metric)
  )
    throw new Error(
      "Financial seasonal bridge requires order and financial sold metrics",
    );
}

function conversionDiagnostics(
  op: Observation[],
  fin: Observation[],
  end: number,
) {
  const current = conversion(op, fin, end);
  const folds: {
    horizon: number;
    absolute: number;
    signed: number;
    actual: number;
    count: number;
    days: number[];
  }[] = [];
  for (const h of [7, 14, 28]) {
    // Three dated origins per horizon; 28-day windows overlap by 14 days.
    // observedDays below discloses the unique target-day count.
    for (let n = 0; n < 3; n++) {
      const cutoff = end - h - Math.min(h, 14) * n;
      const learned = conversion(
        op.filter((p) => p.day <= cutoff),
        fin.filter((p) => p.day <= cutoff),
        cutoff,
      );
      if (learned.ratio === null) continue;
      const actualFinancial = new Map(
        fin
          .filter((p) => p.day > cutoff && p.day <= cutoff + h)
          .map((p) => [p.day, p.units]),
      );
      const paired = op.flatMap((p) => {
        const sold = actualFinancial.get(p.day);
        return sold === undefined
          ? []
          : [{ day: p.day, ordered: p.units, sold }];
      });
      if (paired.length / h < 0.8) continue;
      // Aggregates tolerate the order-to-buyout day lag; this does not manufacture
      // daily orders from financial facts or claim their dates are interchangeable.
      const actual = paired.reduce((sum, p) => sum + p.ordered, 0);
      const predicted =
        paired.reduce((sum, p) => sum + p.sold, 0) * learned.ratio;
      folds.push({
        horizon: h,
        actual,
        signed: predicted - actual,
        absolute: Math.abs(predicted - actual),
        count: paired.length,
        days: paired.map((p) => p.day),
      });
    }
  }
  const absolute = folds.reduce((n, f) => n + f.absolute, 0),
    signed = folds.reduce((n, f) => n + f.signed, 0),
    actual = folds.reduce((n, f) => n + f.actual, 0),
    count = folds.reduce((n, f) => n + f.count, 0);
  const confirmedHorizons = [7, 14, 28].filter((h) => {
    const group = folds.filter((f) => f.horizon === h);
    const totalActual = group.reduce((n, f) => n + f.actual, 0);
    return (
      group.length >= 3 &&
      totalActual > 0 &&
      group.reduce((n, f) => n + f.absolute, 0) / totalActual <= 0.35 &&
      group.filter((f) => f.actual > 0 && f.absolute / f.actual <= 0.35)
        .length >= 2
    );
  });
  return { current, folds, absolute, signed, actual, count, confirmedHorizons };
}

/** Two distinct proofs for a short operational archive: annual_growth must pass
 * the financial metric's own full-horizon tests, while the conversion is checked
 * on actual overlapping order/financial observations at 7/14/28-day horizons.
 *
 * The latter is a retrospective conversion diagnostic, NOT an end-to-end
 * long-horizon order backtest (holdout financial totals are not known in advance).
 * Therefore this entire composition remains an explicitly preliminary scenario.
 */
export function calibrateFinancialSeasonalBridge(
  operational: ForecastSeries,
  financial: ForecastSeries,
  asOf: string,
  horizon: number,
  baselineHistoryDays = 56,
): FinancialCalibration {
  assertFinancialBridgeIdentity(operational, financial);
  const end = Date.parse(asOf) / DAY;
  const op = checkedBridgeObservations(operational, end),
    fin = checkedBridgeObservations(financial, end);
  // runForecast validates dates, values, coverage, and prefix-only annual tests.
  const financialResult = runForecast(financial, {
    asOf,
    horizonDays: horizon,
    baselineHistoryDays,
    allowAutoregressive: false,
  });
  const annual = financialResult.candidates.find(
    (c) => c.model === "annual_growth",
  );
  const financialWorking = annual?.metrics?.byHorizon.find(
    (m) => m.horizonDays === horizon,
  );
  const { current, folds, absolute, signed, actual, count, confirmedHorizons } =
    conversionDiagnostics(op, fin, end);
  let reason = current.reason;
  if (
    !reason &&
    (!annual?.eligible || !financialWorking || financialWorking.folds < 3)
  )
    reason =
      "Годовая форма выкупов с динамикой текущего года не подтверждена на нужном горизонте.";
  if (!reason && !confirmedHorizons.includes(14))
    reason = "Связь выкупов и заказов неустойчива в проверочных периодах.";
  const fitted = fitUnvalidatedAnnualForecast(
    financial,
    asOf,
    horizon,
    baselineHistoryDays,
  );
  if (!reason && fitted.reason) reason = fitted.reason;
  const orderLevel = mean(
    op.filter((p) => p.day > end - 56).map((p) => p.units),
  );
  const sorted = op.map((p) => p.units).sort((a, b) => a - b);
  const cap = Math.max(
    1,
    orderLevel * 4,
    (sorted[Math.floor((sorted.length - 1) * 0.98)] ?? 0) * 4,
  );
  const dailyForecast =
    reason || current.ratio === null
      ? []
      : fitted.dailyForecast.map((p) => ({
          date: p.date,
          units: round(clamp(p.units * current.ratio!, 0, cap)),
        }));
  return {
    candidate: {
      model: "financial_seasonal_bridge_v1",
      label: "Сезон выкупов и связь с заказами: предварительный прогноз",
      eligible: reason === null,
      reason,
      // Diagnostics describe conversion totals only, never 106-day order skill.
      mae: count ? round(absolute / count) : null,
      wape: actual ? round(absolute / actual) : null,
      bias: count ? round(signed / count) : null,
      folds: folds.length,
    },
    dailyForecast,
    totalUnits: round(dailyForecast.reduce((n, p) => n + p.units, 0)),
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify({
          version: "financial-seasonal-bridge-v1",
          asOf,
          horizon,
          baselineHistoryDays,
          provider: operational.provider,
          store: operational.storeId,
          externalId: operational.externalId,
          operationalMetric: operational.metric,
          financialMetric: financial.metric,
          operational: op,
          financial: fin,
          financialFingerprint: financialResult.fingerprint,
        }),
      )
      .digest("hex"),
    seasonalityKnown: annual?.eligible === true,
    scenario: true,
    financialValidation: {
      model: "annual_growth",
      horizonDays: horizon,
      folds: financialWorking?.folds ?? 0,
      wape: financialWorking?.wape ?? null,
    },
    bridgeValidation: {
      horizonDays: confirmedHorizons,
      folds: folds.length,
      observedDays: new Set(folds.flatMap((f) => f.days)).size,
      wape: actual ? round(absolute / actual) : null,
    },
  };
}

function validDay(value: string): number {
  const stamp = Date.parse(value);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(stamp) ||
    new Date(stamp).toISOString().slice(0, 10) !== value
  )
    throw new Error("Financial bridge dates must use valid YYYY-MM-DD dates");
  return stamp / DAY;
}

function checkedBridgeObservations(series: ForecastSeries, end: number) {
  if (!Array.isArray(series.points) || series.points.length > 30_000)
    throw new Error("Financial bridge history size is invalid");
  const seen = new Set<number>();
  for (const point of series.points) {
    const day = validDay(point.date);
    if (day > end) continue;
    if (seen.has(day))
      throw new Error("Financial bridge contains duplicate dates");
    seen.add(day);
    if (
      point.units !== null &&
      (!Number.isFinite(point.units) ||
        point.units < 0 ||
        point.units > 1_000_000_000)
    )
      throw new Error(
        "Financial bridge units must be finite nonnegative quantities",
      );
    if (!["available", "out_of_stock", "unknown"].includes(point.availability))
      throw new Error("Financial bridge availability is invalid");
  }
  return observed(series, end);
}

/** Convert an explicitly preliminary, externally fitted financial seasonal shape
 * into operational units. A shape may come from this card's prior year or a
 * category cohort. This function never promotes its seasonal evidence to ML:
 * only the contemporaneous numerical conversion is checked on held-out periods.
 * The supplied shape must already contain its financial current-year level; its
 * conversion to current order units is applied exactly once here.
 */
export function projectFinancialSeasonalScenario(
  operational: ForecastSeries,
  financial: ForecastSeries,
  financialForecast: ForecastDailyValue[],
  asOf: string,
): FinancialCalibration {
  assertFinancialBridgeIdentity(operational, financial);
  const end = validDay(asOf);
  if (!Array.isArray(financialForecast) || financialForecast.length > 366)
    throw new Error(
      "Financial seasonal scenario horizon must be at most 366 days",
    );
  financialForecast.forEach((p, i) => {
    if (
      validDay(p.date) !== end + i + 1 ||
      !Number.isFinite(p.units) ||
      p.units < 0 ||
      p.units > 1_000_000_000
    )
      throw new Error(
        "Financial seasonal scenario must contain consecutive future days with finite nonnegative units",
      );
  });
  const op = checkedBridgeObservations(operational, end),
    fin = checkedBridgeObservations(financial, end);
  const { current, folds, absolute, signed, actual, count, confirmedHorizons } =
    conversionDiagnostics(op, fin, end);
  let reason = current.reason;
  if (!reason && !financialForecast.length)
    reason = "Нет сезонной формы выкупов для будущих дней.";
  if (!reason && !confirmedHorizons.includes(14))
    reason = "Связь выкупов и заказов неустойчива в проверочных периодах.";
  const orderLevel = mean(
    op.filter((p) => p.day > end - 56).map((p) => p.units),
  );
  const sorted = op.map((p) => p.units).sort((a, b) => a - b);
  const cap = Math.max(
    1,
    orderLevel * 4,
    (sorted[Math.floor((sorted.length - 1) * 0.98)] ?? 0) * 4,
  );
  const dailyForecast =
    reason || current.ratio === null
      ? []
      : financialForecast.map((p) => ({
          date: p.date,
          units: round(clamp(p.units * current.ratio!, 0, cap)),
        }));
  return {
    candidate: {
      model: "financial_seasonal_scenario_bridge_v1",
      label: "Прошлогодний сезон и текущие заказы: предварительный сценарий",
      eligible: reason === null,
      reason,
      mae: count ? round(absolute / count) : null,
      wape: actual ? round(absolute / actual) : null,
      bias: count ? round(signed / count) : null,
      folds: folds.length,
    },
    dailyForecast,
    totalUnits: round(dailyForecast.reduce((n, p) => n + p.units, 0)),
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify({
          version: "financial-seasonal-scenario-bridge-v1",
          asOf,
          provider: operational.provider,
          store: operational.storeId,
          externalId: operational.externalId,
          operationalMetric: operational.metric,
          financialMetric: financial.metric,
          operational: op,
          financial: fin,
          financialForecast,
        }),
      )
      .digest("hex"),
    message:
      reason ??
      "Сезонный сценарий переведён в текущий объём заказов по сопоставимым дням. Проверена связь показателей на коротких периодах; долгосрочная точность заказов ещё не подтверждена.",
    scenario: true,
    seasonalityKnown: false,
    bridgeValidation: {
      horizonDays: confirmedHorizons,
      folds: folds.length,
      observedDays: new Set(folds.flatMap((f) => f.days)).size,
      wape: actual ? round(absolute / actual) : null,
    },
  };
}
