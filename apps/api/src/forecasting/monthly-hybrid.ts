import { createHash } from "node:crypto";
import { runForecast } from "./engine";
import type {
  ForecastDailyValue,
  ForecastOptions,
  ForecastResult,
  ForecastSeries,
} from "./engine-types";
export const MONTHLY_ML_DAYS = 30;
export interface MonthlyHybridForecast {
  long: ForecastResult;
  monthly: ForecastResult;
  usesMonthlyForecast: boolean;
  usesMonthlyMl: boolean;
  usesMonthlySeasonal: boolean;
  dailyForecast: ForecastDailyValue[];
  fingerprint: string;
}
/** Compose an explicitly bounded segment with a separate long-range curve.
 * A 30-day continuity policy fades the terminal level correction, not the short
 * model itself. This transition is not evidence of skill beyond the segment. */
export function applyForecastSegment(
  segment: ForecastDailyValue[],
  tail: ForecastDailyValue[],
): ForecastDailyValue[] {
  if (!segment.length) return tail.map((point) => ({ ...point }));
  const predicted = new Map(segment.map((point) => [point.date, point.units]));
  const terminal = [...segment]
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1)!;
  const terminalDay = Date.parse(terminal.date) / 86_400_000;
  const firstTail = tail
    .filter((point) => point.date > terminal.date)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!firstTail)
    return tail.map((point) => ({
      date: point.date,
      units: predicted.get(point.date) ?? point.units,
    }));
  const positiveLevels = terminal.units > 0 && firstTail.units > 0;
  const logRatio = positiveLevels
    ? Math.log(terminal.units) - Math.log(firstTail.units)
    : 0;
  const residual = terminal.units - firstTail.units;
  return tail.map((point) => {
    const exact = predicted.get(point.date);
    if (exact !== undefined) return { date: point.date, units: exact };
    const offset = Date.parse(point.date) / 86_400_000 - terminalDay;
    if (offset < 1 || offset >= MONTHLY_ML_DAYS) return { ...point };
    if (offset === 1) return { date: point.date, units: terminal.units };
    const progress = (offset - 1) / (MONTHLY_ML_DAYS - 1);
    const weight = 1 - progress * progress * (3 - 2 * progress);
    const units = positiveLevels
      ? point.units * Math.exp(logRatio * weight)
      : point.units + residual * weight;
    return {
      date: point.date,
      units: Math.round(Math.max(0, units) * 1_000_000) / 1_000_000,
    };
  });
}
/** Only a validated short candidate may replace the same dates in the long curve. */
export function applyMonthlySegment(
  monthly: ForecastResult,
  tail: ForecastDailyValue[],
): ForecastDailyValue[] {
  const candidate = monthly.candidates.find(
    (c) => c.model === monthly.selectedModel,
  );
  if (monthly.selectedModel === "mean" || !candidate?.eligible)
    return tail.map((p) => ({ ...p }));
  return applyForecastSegment(monthly.dailyForecast, tail);
}
/** Evaluate the exact 30-day target separately from distant marketplace coverage. */
export function runMonthlyHybridForecast(
  series: ForecastSeries,
  options: ForecastOptions,
): MonthlyHybridForecast {
  const long = runForecast(series, {
    ...options,
    minUnits: undefined,
    allowAutoregressive: false,
  });
  const monthly = runForecast(series, {
    ...options,
    minUnits: undefined,
    horizonDays: MONTHLY_ML_DAYS,
    allowAutoregressive: true,
  });
  const usesMonthlyForecast =
    monthly.selectedModel !== "mean" &&
    monthly.candidates.some(
      (c) => c.model === monthly.selectedModel && c.eligible,
    );
  const usesMonthlyMl =
    usesMonthlyForecast &&
    ["autoregressive", "ridge"].includes(monthly.selectedModel);
  const usesMonthlySeasonal =
    usesMonthlyForecast &&
    ["annual_seasonal", "annual_growth"].includes(monthly.selectedModel);
  return {
    long,
    monthly,
    usesMonthlyForecast,
    usesMonthlyMl,
    usesMonthlySeasonal,
    dailyForecast: applyMonthlySegment(monthly, long.dailyForecast),
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify({
          version: "monthly-hybrid-v4",
          long: long.fingerprint,
          monthly: monthly.fingerprint,
        }),
      )
      .digest("hex"),
  };
}
