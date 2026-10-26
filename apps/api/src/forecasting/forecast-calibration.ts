import { createHash } from "node:crypto";
import type { ForecastSeries, ForecastDailyValue } from "./engine-types";
import type { ForecastCandidateDto } from "./forecast-dto";
import { baselineFromObservations } from "./demand-baseline";
import { newYearScenarioFromObservations } from "./new-year-scenario";

const DAY = 86_400_000;
const MODEL = "financial_calibrated";
const LABEL = "Сезон выкупов с проверкой по заказам";
const VERSION = "financial-calibration-v1";
type Observation = { day: number; units: number };
interface CalibrationFit {
  values: number[] | null;
  reason: string | null;
}
export interface FinancialCalibration {
  candidate: ForecastCandidateDto;
  dailyForecast: ForecastDailyValue[];
  totalUnits: number;
  fingerprint: string;
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
  const current = fit(op, fin, end, horizon);
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
      const fitted = fit(prefix, financialPrefix, cutoff, h);
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
      model: MODEL,
      label: LABEL,
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
