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
  usesMonthlyMl: boolean;
  dailyForecast: ForecastDailyValue[];
  fingerprint: string;
}
/** The short segment never grants permission to extend its learned curve into an untested tail. */
export function applyMonthlySegment(
  monthly: ForecastResult,
  tail: ForecastDailyValue[],
): ForecastDailyValue[] {
  const candidate = monthly.candidates.find(
    (c) => c.model === "autoregressive",
  );
  if (monthly.selectedModel !== "autoregressive" || !candidate?.eligible)
    return tail.map((p) => ({ ...p }));
  const predicted = new Map(
    monthly.dailyForecast.map((p) => [p.date, p.units]),
  );
  return tail.map((p) => ({
    date: p.date,
    units: predicted.get(p.date) ?? p.units,
  }));
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
  const usesMonthlyMl =
    monthly.selectedModel === "autoregressive" &&
    monthly.candidates.some((c) => c.model === "autoregressive" && c.eligible);
  return {
    long,
    monthly,
    usesMonthlyMl,
    dailyForecast: applyMonthlySegment(monthly, long.dailyForecast),
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify({
          version: "monthly-hybrid-v1",
          long: long.fingerprint,
          monthly: monthly.fingerprint,
        }),
      )
      .digest("hex"),
  };
}
