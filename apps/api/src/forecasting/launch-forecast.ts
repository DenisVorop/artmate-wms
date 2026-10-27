import type { MarketplaceResolution } from "../marketplaces/planning-resolutions";
import type {
  MarketplaceProvider,
  MarketplaceSnapshot,
} from "../marketplaces/providers/types";
import type { MarketplaceState } from "../marketplaces/storage";
import type { SkuDto } from "../dto";
import type { ForecastHistorySeries } from "./history-types";
import type { ForecastPlanSource } from "./forecast-storage";

type Source = Omit<ForecastPlanSource, "provider">;
export interface LaunchForecastInput {
  asOf: string;
  generatedAt?: string;
  skus: SkuDto[];
  mappings: MarketplaceState["mappings"];
  snapshots: MarketplaceSnapshot[];
  series?: ForecastHistorySeries[];
  connections?: {
    provider: MarketplaceProvider;
    storeId: string | null;
    version?: number;
  }[];
  resolutions?: MarketplaceResolution[];
}
const DAY = 86400000;
const label = "Прогноз запуска новинки";
export const isLaunchForecastSource = (source: Source) =>
  source.methodLabel.startsWith(label);

/** Known operational net orders only. Financial metrics never enter launch quantities. */
function knownDemand(
  input: LaunchForecastInput,
  provider: MarketplaceProvider,
  externalId: string,
) {
  const connection = input.connections?.find((c) => c.provider === provider);
  const records =
    input.series?.filter(
      (s) =>
        s.provider === provider &&
        s.externalId === externalId &&
        s.storeId === connection?.storeId,
    ) ?? [];
  const ordered = records.find((s) => s.metric === "ordered"),
    cancelled = records.find((s) => s.metric === "cancelled");
  if (ordered && cancelled) {
    const cancels = new Map(cancelled.points.map((p) => [p.date, p]));
    return ordered.points.flatMap((p) => {
      const c = cancels.get(p.date);
      return p.date <= input.asOf && p.units !== null && c?.units != null
        ? [
            {
              date: p.date,
              units: Math.max(0, p.units - c.units),
              availability:
                p.availability === "out_of_stock" ||
                c.availability === "out_of_stock"
                  ? "out_of_stock"
                  : p.availability,
            },
          ]
        : [];
    });
  }
  const snapshot = input.snapshots.find((s) => s.provider === provider);
  if (!snapshot?.coverage.demand) return [];
  const mapping = input.mappings.find(
    (m) => m.provider === provider && m.externalId === externalId,
  );
  const demand = snapshot.demand.filter(
    (p) =>
      p.externalId === externalId &&
      p.date >= snapshot.from &&
      p.date <= snapshot.to &&
      p.date <= input.asOf,
  );
  if (!demand.length) return [];
  const first = demand.reduce(
    (a, p) => (p.date < a ? p.date : a),
    demand[0]!.date,
  );
  const sums = new Map<string, number>();
  for (const p of demand)
    sums.set(
      p.date,
      (sums.get(p.date) ?? 0) +
        Math.max(0, p.orderedUnits - p.cancelledUnits) *
          (mapping?.unitsPerItem ?? 1),
    );
  const result = [];
  // API coverage establishes zeros only after the first actual appearance, never before launch.
  for (
    let t = Date.parse(first);
    t <= Math.min(Date.parse(snapshot.to), Date.parse(input.asOf));
    t += DAY
  ) {
    const date = new Date(t).toISOString().slice(0, 10);
    result.push({ date, units: sums.get(date) ?? 0, availability: "unknown" });
  }
  return result;
}
function activeLaunch(
  input: LaunchForecastInput,
  provider: MarketplaceProvider,
  externalId: string,
) {
  const connection = input.connections?.find((c) => c.provider === provider);
  const mapping = input.mappings.find(
    (m) => m.provider === provider && m.externalId === externalId,
  );
  if (!connection?.storeId || connection.version === undefined || !mapping)
    return undefined;
  const at = Date.parse(input.generatedAt ?? `${input.asOf}T23:59:59.999Z`);
  return input.resolutions?.find(
    (r) =>
      r.kind === "launch" &&
      r.enabled &&
      r.provider === provider &&
      r.externalId === externalId &&
      r.storeId === connection.storeId &&
      r.connectionVersion === connection.version &&
      r.skuId === mapping.skuId &&
      (!r.expiresAt || Date.parse(r.expiresAt) > at) &&
      r.donorProvider &&
      r.donorProvider !== provider &&
      input.connections?.some(
        (donor) =>
          donor.provider === r.donorProvider &&
          donor.storeId === r.donorStoreId &&
          donor.version !== undefined &&
          donor.version === r.donorConnectionVersion,
      ),
  );
}
/**
 * A launch estimate borrows the same product's donor curve and the median marketplace
 * share of >=3 comparable SKUs. Ratios are bounded to 0.25..4 to limit small-sample
 * extrapolation. This is an explicit low-confidence scenario, never ML validation.
 */
export function resolveLaunchForecast(
  input: LaunchForecastInput,
  provider: MarketplaceProvider,
  externalId: string,
  horizonDays: number,
  baselineSource: Source,
  donorForecast: (
    provider: MarketplaceProvider,
    externalId: string,
    horizonDays: number,
  ) => Source,
): Source {
  const policy = activeLaunch(input, provider, externalId);
  if (!policy) return baselineSource;
  const start = new Date(Date.parse(input.asOf) - 55 * DAY)
    .toISOString()
    .slice(0, 10);
  const own = knownDemand(input, provider, externalId).filter(
    (p) => p.date >= start,
  );
  // Once saleable observations exist, own demand takes over without editing history or policy.
  if (own.filter((p) => p.availability === "available").length >= 14)
    return baselineSource;
  const unknown = (reason: string): Source => ({
    ...baselineSource,
    dailyForecast: baselineSource.dailyForecast.map((p) => ({
      ...p,
      units: 0,
    })),
    methodLabel: `${label}: ${reason}`,
    confidenceLabel: "Предварительная оценка",
    scenario: true,
    salesForecastKnown: false,
  });
  const mapping = input.mappings.find(
    (m) => m.provider === provider && m.externalId === externalId,
  )!;
  const sku = input.skus.find((s) => s.id === mapping.skuId);
  const donors = input.mappings.filter(
    (m) => m.provider === policy.donorProvider && m.skuId === mapping.skuId,
  );
  if (
    !sku ||
    donors.length !== 1 ||
    !input.connections?.some(
      (c) => c.provider === policy.donorProvider && c.storeId,
    )
  )
    return unknown("нет продаж этого товара на второй площадке");
  const donor = donorForecast(
    policy.donorProvider!,
    donors[0]!.externalId,
    horizonDays,
  );
  if (
    !donor.salesForecastKnown ||
    donor.dailyForecast.length !== horizonDays ||
    donor.dailyForecast.some(
      (p) => p.date <= input.asOf || !Number.isFinite(p.units) || p.units < 0,
    ) ||
    !donor.dailyForecast.some((p) => p.units > 0)
  )
    return unknown("недостаточно продаж этого товара на второй площадке");
  const ratios: number[] = [];
  for (const analogue of input.skus.filter(
    (s) => s.id !== sku.id && s.unitsPerBox === sku.unitsPerBox,
  )) {
    const targetMaps = input.mappings.filter(
      (m) => m.provider === provider && m.skuId === analogue.id,
    );
    const donorMaps = input.mappings.filter(
      (m) => m.provider === policy.donorProvider && m.skuId === analogue.id,
    );
    if (
      targetMaps.length !== 1 ||
      donorMaps.length !== 1 ||
      activeLaunch(input, provider, targetMaps[0]!.externalId) ||
      activeLaunch(input, policy.donorProvider!, donorMaps[0]!.externalId)
    )
      continue;
    const target = knownDemand(
      input,
      provider,
      targetMaps[0]!.externalId,
    ).filter((p) => p.date >= start && p.availability !== "out_of_stock");
    const other = new Map(
      knownDemand(input, policy.donorProvider!, donorMaps[0]!.externalId)
        .filter((p) => p.date >= start && p.availability !== "out_of_stock")
        .map((p) => [p.date, p.units]),
    );
    const pairs = target.filter((p) => other.has(p.date));
    const targetUnits = pairs.reduce((n, p) => n + p.units, 0),
      donorUnits = pairs.reduce((n, p) => n + other.get(p.date)!, 0);
    if (
      pairs.length < 14 ||
      pairs.filter((p) => p.units > 0).length < 3 ||
      pairs.filter((p) => other.get(p.date)! > 0).length < 3 ||
      targetUnits < 5 ||
      donorUnits < 5
    )
      continue;
    ratios.push(targetUnits / donorUnits);
  }
  if (ratios.length < 3) return unknown("недостаточно сопоставимых тематик");
  ratios.sort((a, b) => a - b);
  const midpoint = Math.floor(ratios.length / 2);
  const median =
    ratios.length % 2
      ? ratios[midpoint]!
      : (ratios[midpoint - 1]! + ratios[midpoint]!) / 2;
  const ratio = Math.max(0.25, Math.min(4, median));
  return {
    dailyForecast: donor.dailyForecast.map((p) => ({
      date: p.date,
      units: p.units * ratio,
    })),
    methodLabel: `${label}: продажи ${policy.donorProvider === "ozon" ? "Ozon" : "WB"} и ${ratios.length} похожих тематик`,
    confidenceLabel: "Предварительная оценка",
    scenario: true,
    salesForecastKnown: true,
  };
}
