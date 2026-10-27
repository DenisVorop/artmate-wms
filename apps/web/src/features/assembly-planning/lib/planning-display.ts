import type { MarketplaceOverviewDto } from "@/entities/assembly-plan";

/** A calculation payload may contain provisional quantities while the worker
 * is publishing the first compatible plan. Only an available plan or the
 * server-selected compatible previous plan may be presented as quantities. */
export function displayedPlanningPlan<T>(
  current: T,
  previous: T | null,
  status: Pick<MarketplaceOverviewDto["planStatus"], "state">,
): T | null {
  if (previous !== null) return previous;
  return status.state === "unavailable" ? null : current;
}
