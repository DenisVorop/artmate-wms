import type { ForecastComputeInput } from "./forecast-projection";
import type { ForecastHistorySeries } from "./history-types";
import type { ForecastSeries } from "./engine-types";
import {
  categorySeasonalScenario,
  ownSeasonalScenario,
  type CategorySeasonalScenario,
} from "./cohort-seasonality";
import { projectFinancialSeasonalScenario } from "./forecast-calibration";

export interface PlanningSeasonalScenario extends Omit<
  CategorySeasonalScenario,
  "donors"
> {
  donors?: number;
  origin: "own" | "category" | "financial_own" | "financial_category";
}
/** Shapes are preliminary planning scenarios, never a promotion of an ineligible ML candidate. */
export function planningSeasonality(
  input: ForecastComputeInput,
  active: ForecastHistorySeries[],
  horizonDays: number,
) {
  const coloringSkus = new Set(
    input.mappings
      .filter((mapping) =>
        input.snapshots.some(
          (snapshot) =>
            snapshot.provider === mapping.provider &&
            snapshot.products.some(
              (product) =>
                product.externalId === mapping.externalId &&
                /раскраск|coloring/i.test(product.name),
            ),
        ),
      )
      .map((mapping) => mapping.skuId),
  );
  const prepared = active.flatMap((history) => {
    if (history.metric === "sold")
      return [
        {
          ...history,
          id: JSON.stringify([
            history.provider,
            history.storeId,
            history.externalId,
            "sold",
          ]),
          metric: "financial_gross_sold",
        },
      ];
    if (history.metric !== "ordered") return [];
    const cancelled = active.find(
      (other) =>
        other.provider === history.provider &&
        other.storeId === history.storeId &&
        other.externalId === history.externalId &&
        other.skuId === history.skuId &&
        other.metric === "cancelled",
    );
    if (!cancelled) return [];
    const cancels = new Map(
      cancelled.points.map((point) => [point.date, point]),
    );
    return [
      {
        ...history,
        id: JSON.stringify([
          history.provider,
          history.storeId,
          history.externalId,
          "ordered",
        ]),
        metric: "net_ordered",
        points: history.points.map((point) => {
          const cancellation = cancels.get(point.date);
          return {
            date: point.date,
            units:
              point.units !== null && cancellation?.units != null
                ? Math.max(0, point.units - cancellation.units)
                : null,
            availability:
              point.availability === "out_of_stock" ||
              cancellation?.availability === "out_of_stock"
                ? ("out_of_stock" as const)
                : point.availability,
          };
        }),
      },
    ];
  });
  const options = {
    asOf: input.asOf,
    horizonDays,
    baselineHistoryDays: input.settings.historyDays,
  };
  const cache = new Map<string, PlanningSeasonalScenario | null>();
  const shape = (
    target: ForecastSeries & { skuId: string },
  ): PlanningSeasonalScenario | null => {
    const own = ownSeasonalScenario(target, options);
    if (own) return { ...own, origin: "own" };
    if (!coloringSkus.has(target.skuId)) return null;
    const seen = new Set<string>();
    const donors = prepared
      .filter(
        (other) =>
          other.skuId !== target.skuId &&
          coloringSkus.has(other.skuId) &&
          other.provider === target.provider &&
          other.storeId === target.storeId &&
          other.metric === target.metric,
      )
      .sort(
        (a, b) =>
          b.points.filter(
            (point) =>
              point.date <= input.asOf &&
              point.units !== null &&
              point.availability !== "out_of_stock",
          ).length -
            a.points.filter(
              (point) =>
                point.date <= input.asOf &&
                point.units !== null &&
                point.availability !== "out_of_stock",
            ).length || a.externalId.localeCompare(b.externalId),
      )
      .filter((other) => !seen.has(other.skuId) && !!seen.add(other.skuId));
    const category = categorySeasonalScenario(target, donors, options);
    return category ? { ...category, origin: "category" } : null;
  };
  return (
    provider: ForecastSeries["provider"],
    externalId: string,
  ): PlanningSeasonalScenario | null => {
    const key = JSON.stringify([provider, externalId]);
    if (cache.has(key)) return cache.get(key)!;
    const target = prepared.find(
      (series) =>
        series.provider === provider &&
        series.externalId === externalId &&
        series.metric === "net_ordered",
    );
    if (!target) {
      cache.set(key, null);
      return null;
    }
    let result = shape(target);
    if (!result) {
      const financial = prepared.find(
        (series) =>
          series.provider === provider &&
          series.storeId === target.storeId &&
          series.externalId === externalId &&
          series.skuId === target.skuId &&
          series.metric === "financial_gross_sold",
      );
      const financialShape = financial ? shape(financial) : null;
      if (financial && financialShape) {
        const bridge = projectFinancialSeasonalScenario(
          target,
          financial,
          financialShape.dailyForecast,
          input.asOf,
        );
        if (bridge.candidate.eligible)
          result = {
            ...financialShape,
            dailyForecast: bridge.dailyForecast,
            origin:
              financialShape.origin === "own"
                ? "financial_own"
                : "financial_category",
            methodLabel: `${financialShape.methodLabel} · по выкупам`,
            message: financialShape.message,
          };
      }
    }
    cache.set(key, result);
    return result;
  };
}
