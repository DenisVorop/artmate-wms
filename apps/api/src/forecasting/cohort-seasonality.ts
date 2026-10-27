import { demandBaseline } from "./demand-baseline";
import type {
  ForecastDailyValue,
  ForecastOptions,
  ForecastSeries,
} from "./engine-types";

const DAY = 86_400_000;
const REFERENCE_DAYS = 28;
const MIN_DONORS = 2;
const MIN_REFERENCE_DAYS = 21;
const MIN_CATEGORY_TARGET_DAYS = 14;
const MATURITY_DAYS = 180;
const MIN_MATURE_OBSERVATIONS = Math.ceil(MATURITY_DAYS * 0.8);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const mean = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / values.length;
const date = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

function parseDay(value: string) {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(timestamp))
    return null;
  return new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp / DAY
    : null;
}

/** Calendar anniversary; a leap day uses the last day of February. */
function previousYear(day: number) {
  const current = new Date(day * DAY);
  const year = current.getUTCFullYear() - 1;
  const month = current.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(current.getUTCDate(), lastDay)) / DAY;
}

function observations(series: ForecastSeries, asOf: number) {
  const values = new Map<number, number>();
  const seen = new Set<number>();
  for (const point of series.points) {
    const day = parseDay(point.date);
    if (day === null) return null;
    // Future observations must not affect eligibility, levels or coefficients.
    if (day > asOf) continue;
    if (seen.has(day)) return null;
    seen.add(day);
    if (point.units === null || point.availability === "out_of_stock") continue;
    if (!Number.isFinite(point.units) || point.units < 0) return null;
    values.set(day, point.units);
  }
  return values;
}

/**
 * First-season product launch/maturation is not evidence of annual seasonality.
 * Require confirmed trading and adequate observations for six months BEFORE the
 * prior reference window, rather than treating padded known zeros as a launch.
 */
function establishedBeforeReference(values: Map<number, number>, asOf: number) {
  const referenceStart = previousYear(asOf - REFERENCE_DAYS + 1);
  const maturityStart = referenceStart - MATURITY_DAYS;
  let firstTrade = Infinity;
  let known = 0;
  for (const [day, units] of values) {
    if (units > 0) firstTrade = Math.min(firstTrade, day);
    if (day >= maturityStart && day < referenceStart) known++;
  }
  return firstTrade <= maturityStart && known >= MIN_MATURE_OBSERVATIONS;
}

export interface CategorySeasonalScenario {
  dailyForecast: ForecastDailyValue[];
  /** Minimum independent donor products supporting any day of the horizon. */
  donors: number;
  referenceLevel: number;
  scenario: true;
  methodLabel: string;
  message: string;
}

export type OwnSeasonalScenario = Omit<CategorySeasonalScenario, "donors">;

/**
 * Observed own-product annual shape when rolling validation cannot yet confirm
 * an annual ML model. Absolute level is calibrated to recent target demand once;
 * the calendar curve is a ratio to the matching recent period one year earlier.
 * This remains a preliminary scenario, never a claim of validated accuracy.
 */
export function ownSeasonalScenario(
  target: ForecastSeries,
  options: Pick<
    ForecastOptions,
    "asOf" | "horizonDays" | "baselineHistoryDays"
  >,
): OwnSeasonalScenario | null {
  const asOf = parseDay(options.asOf);
  if (
    asOf === null ||
    !Number.isInteger(options.horizonDays) ||
    options.horizonDays < 1 ||
    options.horizonDays > 366
  )
    return null;
  const values = observations(target, asOf);
  if (!values || !establishedBeforeReference(values, asOf)) return null;
  const recent = [...values.keys()].filter(
    (day) => day > asOf - REFERENCE_DAYS,
  );
  if (
    recent.length < MIN_REFERENCE_DAYS ||
    recent.filter((day) => day > asOf - 7).length < 5
  )
    return null;
  const prior: number[] = [];
  for (let offset = 0; offset < REFERENCE_DAYS; offset++) {
    const value = values.get(previousYear(asOf - offset));
    if (value !== undefined) prior.push(value);
  }
  if (prior.length < MIN_REFERENCE_DAYS) return null;
  const priorLevel = demandBaseline(
    target.points,
    date(previousYear(asOf)),
    1,
    Math.min(REFERENCE_DAYS, options.baselineHistoryDays ?? REFERENCE_DAYS),
  ).dailyForecast[0].units;
  if (!(priorLevel > 0)) return null;
  const baseline = demandBaseline(
    target.points,
    options.asOf,
    1,
    Math.min(REFERENCE_DAYS, options.baselineHistoryDays ?? REFERENCE_DAYS),
  );
  const referenceLevel = baseline.dailyForecast[0].units;
  if (!(referenceLevel > 0) || !Number.isFinite(referenceLevel)) return null;
  const dailyForecast: ForecastDailyValue[] = [];
  let changedDays = 0;
  for (let offset = 1; offset <= options.horizonDays; offset++) {
    const historical = previousYear(asOf + offset);
    const local: number[] = [];
    for (let delta = -3; delta <= 3; delta++) {
      const day = historical + delta;
      if (day > asOf) continue;
      const value = values.get(day);
      if (value !== undefined) local.push(value);
    }
    if (local.length < 5) return null;
    const ratio = Math.max(0, Math.min(8, mean(local) / priorLevel));
    if (!Number.isFinite(ratio)) return null;
    if (Math.abs(ratio - 1) > 0.1) changedDays++;
    dailyForecast.push({
      date: date(asOf + offset),
      units: Math.round(referenceLevel * ratio * 1_000_000) / 1_000_000,
    });
  }
  if (changedDays < 7) return null;
  return {
    dailyForecast,
    referenceLevel,
    scenario: true,
    methodLabel: "Прошлый сезон и текущий спрос",
    message:
      "Используем прошлогоднюю динамику этого товара, откалиброванную по текущему спросу. " +
      "Это предварительный сезонный сценарий: преимущество на полном горизонте пока не подтверждено историческими проверками.",
  };
}

/**
 * Preliminary scenario for a product without its own annual history. The caller
 * supplies an explicitly identified product category, one series per donor SKU,
 * and excludes every card belonging to the target SKU. This function additionally
 * enforces store/provider/metric/card isolation. It never claims validated ML.
 *
 * Absolute volume comes only from the target's current observations. Donors
 * contribute dimensionless calendar shape, normalized to the equivalent recent
 * window last year. Thus an uplift already present in today's run rate is not
 * multiplied a second time. No month or holiday has a hard-coded uplift.
 */
export function categorySeasonalScenario(
  target: ForecastSeries,
  donors: ForecastSeries[],
  options: Pick<
    ForecastOptions,
    "asOf" | "horizonDays" | "baselineHistoryDays"
  >,
): CategorySeasonalScenario | null {
  const asOf = parseDay(options.asOf);
  if (
    asOf === null ||
    !Number.isInteger(options.horizonDays) ||
    options.horizonDays < 1 ||
    options.horizonDays > 366
  )
    return null;
  const targetValues = observations(target, asOf);
  if (!targetValues) return null;
  const recentDays = [...targetValues.keys()].filter(
    (day) => day > asOf - REFERENCE_DAYS,
  );
  if (
    recentDays.length < MIN_CATEGORY_TARGET_DAYS ||
    recentDays.filter((day) => day > asOf - 7).length < 5
  )
    return null;
  const baseline = demandBaseline(
    target.points,
    options.asOf,
    1,
    Math.min(REFERENCE_DAYS, options.baselineHistoryDays ?? REFERENCE_DAYS),
  );
  const referenceLevel = baseline.dailyForecast[0].units;
  if (!(referenceLevel > 0) || !Number.isFinite(referenceLevel)) return null;

  const identities = new Set<string>();
  const candidates: { values: Map<number, number>; reference: number }[] = [];
  for (const donor of donors) {
    if (
      donor.provider !== target.provider ||
      donor.storeId !== target.storeId ||
      donor.metric !== target.metric ||
      donor.externalId === target.externalId ||
      identities.has(donor.externalId)
    )
      continue;
    identities.add(donor.externalId);
    const values = observations(donor, asOf);
    if (!values || !establishedBeforeReference(values, asOf)) continue;
    const reference: number[] = [];
    for (let offset = 0; offset < REFERENCE_DAYS; offset++) {
      const value = values.get(previousYear(asOf - offset));
      if (value !== undefined) reference.push(value);
    }
    if (reference.length < MIN_REFERENCE_DAYS) continue;
    const level = demandBaseline(
      donor.points,
      date(previousYear(asOf)),
      1,
      Math.min(REFERENCE_DAYS, options.baselineHistoryDays ?? REFERENCE_DAYS),
    ).dailyForecast[0].units;
    // A zero reference cannot establish a finite seasonal coefficient.
    if (!(level > 0)) continue;
    candidates.push({ values, reference: level });
  }
  if (candidates.length < MIN_DONORS) return null;

  let minimumSupport = candidates.length;
  let changed = false;
  const dailyForecast: ForecastDailyValue[] = [];
  for (let offset = 1; offset <= options.horizonDays; offset++) {
    const futureDay = asOf + offset;
    const historicalDay = previousYear(futureDay);
    const ratios: number[] = [];
    for (const donor of candidates) {
      const local: number[] = [];
      for (let delta = -3; delta <= 3; delta++) {
        const day = historicalDay + delta;
        if (day > asOf) continue;
        const value = donor.values.get(day);
        if (value !== undefined) local.push(value);
      }
      if (local.length >= 5) {
        const ratio = mean(local) / donor.reference;
        if (Number.isFinite(ratio)) ratios.push(ratio);
      }
    }
    // Never splice a supported seasonal month into an unsupported constant tail.
    if (ratios.length < MIN_DONORS) return null;
    minimumSupport = Math.min(minimumSupport, ratios.length);
    const upward = ratios.filter((value) => value > 1.1).length;
    const downward = ratios.filter((value) => value < 0.9).length;
    const coherent =
      ratios.length === 2
        ? upward === 2 || downward === 2
        : Math.max(upward, downward) / ratios.length >= 2 / 3;
    // Two peers must agree unanimously: use the smaller change rather than
    // averaging one exceptional peer into the target. With >=3, the median
    // protects against one exceptional donor. Bound near-zero reference ratios.
    const supportedRatio =
      ratios.length === 2
        ? upward === 2
          ? Math.min(...ratios)
          : Math.max(...ratios)
        : median(ratios);
    const ratio = coherent ? Math.max(0, Math.min(8, supportedRatio)) : 1;
    if (Math.abs(ratio - 1) > 1e-8) changed = true;
    dailyForecast.push({
      date: date(futureDay),
      units: Math.round(referenceLevel * ratio * 1_000_000) / 1_000_000,
    });
  }
  if (!changed) return null;
  return {
    dailyForecast,
    donors: minimumSupport,
    referenceLevel,
    scenario: true,
    methodLabel: "Предварительная сезонность категории",
    message:
      `Для собственной сезонной оценки пока недостаточно устойчивой истории. Используем текущий спрос и ` +
      `прошлогоднюю динамику ${minimumSupport} других тематик на той же площадке. ` +
      (minimumSupport === 2
        ? "Две тематики должны совпадать по направлению; берём меньшее отклонение от текущего спроса. "
        : "") +
      "Это предварительный сценарий; его точность ещё не подтверждена продажами этого товара.",
  };
}
