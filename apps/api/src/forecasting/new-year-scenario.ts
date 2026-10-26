import {
  demandBaseline,
  baselineFromObservations,
  type DemandObservation,
  type DemandBaseline,
} from "./demand-baseline";
import type { ForecastDailyValue, ForecastPoint } from "./engine-types";
/** Explicit planning scenario, not a learned annual coefficient or observed sales. */
export function newYearScenario(
  points: ForecastPoint[],
  asOf: string,
  horizonDays: number,
  historyDays: number,
): { dailyForecast: ForecastDailyValue[]; scenario: boolean; message: string } {
  const fallback = demandBaseline(points, asOf, horizonDays, historyDays);
  return applyScenario(fallback, asOf);
}
export function newYearScenarioFromObservations(
  values: DemandObservation[],
  asOf: number,
  horizonDays: number,
  historyDays: number,
) {
  return applyScenario(
    baselineFromObservations(values, asOf, horizonDays, historyDays),
    new Date(asOf * 86400000).toISOString().slice(0, 10),
  );
}
function applyScenario(
  fallback: DemandBaseline,
  asOf: string,
): { dailyForecast: ForecastDailyValue[]; scenario: boolean; message: string } {
  const current = new Date(asOf),
    year = current.getUTCFullYear(),
    month = current.getUTCMonth();
  if (month < 9 || fallback.knownDays < 14 || fallback.recentTrend <= 1.05)
    return {
      dailyForecast: fallback.dailyForecast,
      scenario: false,
      message:
        "Недостаточно подтверждённого роста для предпраздничного сценария.",
    };
  // Hold the observed recent run rate through the holiday window; never multiply
  // an already observed uplift again, invent a fixed seasonal percentage, or extend it into January.
  const cap = Math.max(
    fallback.baseLevel,
    Math.min(fallback.recentLevel, fallback.baseLevel * 1.5),
  );
  let scenario = false;
  const dailyForecast = fallback.dailyForecast.map((p) => {
    const date = new Date(p.date),
      holiday = date.getUTCFullYear() === year && date.getUTCMonth() >= 10;
    const units = holiday ? Math.max(p.units, cap) : p.units;
    if (units > p.units + 1e-8) scenario = true;
    return { date: p.date, units };
  });
  return {
    dailyForecast,
    scenario,
    message: scenario
      ? "Сценарий к Новому году: сохраняем наблюдаемый рост только до конца декабря. Годовая сезонность пока не подтверждена."
      : "Предпраздничный сценарий не меняет текущую оценку спроса.",
  };
}
