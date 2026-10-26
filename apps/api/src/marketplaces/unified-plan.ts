import type { MarketplaceProviderPlanDto } from "./dto";
import type { ForecastPlanSource } from "../forecasting/forecast-storage";
const DAY = 86_400_000;
export const PREPARATION_DAYS = 30;
export const UNIFIED_PLAN_VERSION = "weekly-month-preparation-v1";
export function preparationSchedule(today: string, firstDispatchDate: string) {
  const through = new Date(Date.parse(today) + (PREPARATION_DAYS - 1) * DAY)
    .toISOString()
    .slice(0, 10);
  const dates: string[] = [];
  for (
    let date = Date.parse(firstDispatchDate);
    date <= Date.parse(through);
    date += 7 * DAY
  )
    dates.push(new Date(date).toISOString().slice(0, 10));
  return { through, dates };
}
export function dispatchSchedule(clock: Date, weekday: number) {
  const today = new Date(clock.getTime() + 10_800_000)
    .toISOString()
    .slice(0, 10);
  const waitDays = (weekday - new Date(today).getUTCDay() + 7) % 7;
  return {
    today,
    waitDays,
    dispatchDate: new Date(Date.parse(today) + waitDays * DAY)
      .toISOString()
      .slice(0, 10),
  };
}
export function forecastQuantity(
  source: ForecastPlanSource,
  from: string,
  days: number,
) {
  const end = new Date(Date.parse(from) + days * DAY)
    .toISOString()
    .slice(0, 10);
  return source.dailyForecast
    .filter((p) => p.date >= from && p.date < end)
    .reduce((sum, p) => sum + Math.max(0, p.units), 0);
}
/** Marketplace targets are isolated: stock at one provider cannot fulfill another. */
export function unifiedStockPlan(input: {
  providers: MarketplaceProviderPlanDto[];
  ownUnits: number;
  reservedUnits: number;
  openTaskUnits: number;
  unitsPerBox: number;
  monthlyOutboundUnits?: number;
}) {
  const providerNeed = input.providers.reduce(
    (sum, p) => sum + p.dispatchUnits,
    0,
  );
  // Legacy warehouse drafts do not record a provider. They are existing outgoing
  // commitments, not an extra copy of the provider demand or inbound supply.
  const newOutboundUnits = Math.max(0, providerNeed - input.reservedUnits);
  const outboundUnits = input.reservedUnits + newOutboundUnits;
  const monthlyOutboundUnits = Math.max(
    outboundUnits,
    input.monthlyOutboundUnits ?? outboundUnits,
  );
  const assemblyShortageUnits = Math.max(
    0,
    monthlyOutboundUnits - input.ownUnits - input.openTaskUnits,
  );
  const recommendedBoxes = Math.ceil(assemblyShortageUnits / input.unitsPerBox);
  const recommendedUnits = recommendedBoxes * input.unitsPerBox;
  return {
    outboundUnits,
    outboundBoxes: Math.ceil(outboundUnits / input.unitsPerBox),
    newOutboundUnits,
    newOutboundBoxes: Math.ceil(newOutboundUnits / input.unitsPerBox),
    dispatchShortageUnits: Math.max(0, outboundUnits - input.ownUnits),
    localAfterDispatchUnits: Math.max(0, input.ownUnits - outboundUnits),
    monthlyOutboundUnits,
    monthlyOutboundBoxes: Math.ceil(monthlyOutboundUnits / input.unitsPerBox),
    monthlyDispatchShortageUnits: Math.max(
      0,
      monthlyOutboundUnits - input.ownUnits,
    ),
    localAfterPlannedDispatchUnits: Math.max(
      0,
      input.ownUnits - monthlyOutboundUnits,
    ),
    assemblyShortageUnits,
    localAfterAssemblyUnits: Math.max(
      0,
      input.ownUnits +
        input.openTaskUnits +
        recommendedUnits -
        monthlyOutboundUnits,
    ),
    recommendedBoxes,
    recommendedUnits,
  };
}
