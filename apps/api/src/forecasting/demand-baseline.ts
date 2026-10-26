import type { ForecastDailyValue, ForecastPoint } from "./engine-types";

const DAY = 86_400_000;
export interface DemandObservation {
  day: number;
  units: number;
}
export interface DemandBaseline {
  dailyForecast: ForecastDailyValue[];
  baseLevel: number;
  recentLevel: number;
  knownDays: number;
  recentTrend: number;
}
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
function quantile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p,
    lo = Math.floor(i),
    hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
/** An isolated bulk order does not become the daily run rate. Known zeros remain zeros. */
export function demandObservationCap(values: number[]): number {
  const positive = values.filter((n) => n > 0);
  // With too few positive events there is no established event-size distribution.
  // Preserve the recorded quantity; disable recency amplification instead of
  // inventing a small clipping threshold and erasing confirmed demand.
  if (positive.length < 3) return Math.max(1, ...positive);
  return Math.max(1, quantile(positive, 0.75) * 3, quantile(values, 0.5) * 4);
}
function robustMean(values: number[], cap: number) {
  return mean(values.map((n) => Math.min(n, cap)));
}
/** Same prefix-only fallback is used in deployed planning and model comparison. */
export function baselineFromObservations(
  values: DemandObservation[],
  asOf: number,
  horizonDays: number,
  historyDays = 56,
): DemandBaseline {
  const recent = values.filter(
    (p) => p.day <= asOf && p.day > asOf - historyDays,
  );
  const cap = demandObservationCap(recent.map((p) => p.units));
  const baseLevel = robustMean(
    recent.map((p) => p.units),
    cap,
  );
  const last28 = recent.filter((p) => p.day > asOf - 28),
    last7 = recent.filter((p) => p.day > asOf - 7);
  const recentMonth =
    last28.length >= Math.min(14, recent.length)
      ? robustMean(
          last28.map((p) => p.units),
          cap,
        )
      : baseLevel;
  const longer =
    recent.filter((p) => p.units > 0).length < 3
      ? baseLevel
      : recent.length > last28.length
        ? 0.7 * recentMonth + 0.3 * baseLevel
        : recentMonth;
  const recentLevel = robustMean(
    last7.map((p) => p.units),
    cap,
  );
  // A sustained change needs several observations, not one promotion or a missing day.
  const canAdapt =
    last7.length >= 5 &&
    last7.filter((p) => p.units > 0).length >= 3 &&
    recent.length >= 14 &&
    longer > 0;
  const recentTrend = canAdapt ? clamp(recentLevel / longer, 0.67, 1.5) : 1;
  const level = canAdapt
    ? clamp(0.65 * longer + 0.35 * recentLevel, longer * 0.75, longer * 1.35)
    : longer;
  return {
    baseLevel: longer,
    recentLevel,
    knownDays: recent.length,
    recentTrend,
    dailyForecast: Array.from({ length: horizonDays }, (_, i) => ({
      date: new Date((asOf + i + 1) * DAY).toISOString().slice(0, 10),
      units:
        Math.round(
          Math.max(0, longer + (level - longer) * Math.exp(-i / 28)) * 1e6,
        ) / 1e6,
    })),
  };
}
export function demandBaseline(
  points: ForecastPoint[],
  asOf: string,
  horizonDays: number,
  historyDays = 56,
): DemandBaseline {
  const end = Date.parse(asOf) / DAY;
  return baselineFromObservations(
    points
      .filter((p) => p.units !== null && p.availability !== "out_of_stock")
      .map((p) => ({ day: Date.parse(p.date) / DAY, units: p.units! })),
    end,
    horizonDays,
    historyDays,
  );
}
