import { initializeForecastJournalStorage } from "./journal-storage";
import type { ForecastFeedbackReport } from "./journal-feedback";
import { activeMarketplaceResolutions } from "../marketplaces/planning-resolutions";
import {
  PREPARATION_DAYS,
  UNIFIED_PLAN_VERSION,
} from "../marketplaces/unified-plan";
import { createHash } from "node:crypto";
import type { Queryable } from "../database";
import type { SkuDto } from "../dto";
import type { MarketplaceState } from "../marketplaces/storage";
import type { ForecastOverviewDto } from "./forecast-dto";
import { FORECAST_MODEL_VERSION } from "./engine";

export interface ForecastPolicy {
  skuId: string;
  minimumBoxes: number;
  seasonalityEnabled: boolean;
}
export interface ForecastPlanSource {
  /** Stable selected algorithm and configuration identity; display labels are not model keys. */
  modelIdentity?: string;
  /** Raw quantities preserved for prospective error calibration. */
  journalBaseForecast?: { date: string; units: number }[];
  salesForecastKnown?: boolean;
  provider: "wildberries" | "ozon";
  dailyForecast: { date: string; units: number }[];
  methodLabel: string;
  confidenceLabel: string;
  scenario: boolean;
}
export interface ForecastPlanGoal {
  sources?: ForecastPlanSource[];
  targetUnits: number;
  methodLabel: string;
  confidenceLabel: string;
  message: string;
  seasonalityApplied: boolean;
}
export interface ForecastPlanContext {
  /** Presentation may retain a prior calculation while its replacement is fitted. */
  cacheCurrent?: boolean;
  key: string;
  goals: Record<string, ForecastPlanGoal>;
  minimumBoxes: Record<string, number>;
  seasonalityEnabled?: Record<string, boolean>;
}
export interface ForecastCache {
  journalFeedback?: ForecastFeedbackReport[];
  key: string;
  generatedAt: string;
  overview: ForecastOverviewDto;
  goals: Record<string, ForecastPlanGoal>;
  modelVersion: string;
  fingerprints: string[];
}
export interface ForecastLease {
  key: string;
  runId: string;
  until: string;
}
export const FORECAST_COMPUTATION_LEASE_MS = 120_000;
export function forecastDay(clock = new Date()) {
  return new Date(clock.getTime() + 10_800_000).toISOString().slice(0, 10);
}
export function forecastAsOf(clock = new Date()) {
  return new Date(Date.parse(forecastDay(clock)) - 86_400_000)
    .toISOString()
    .slice(0, 10);
}
export async function initializeForecastStorage(tx: Queryable) {
  await initializeForecastJournalStorage(tx);
  for (const table of ["forecast_policies", "forecast_results"])
    await tx.query(
      `CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,payload JSONB NOT NULL)`,
    );
}
export async function putForecast(
  tx: Queryable,
  table: "forecast_policies" | "forecast_results",
  id: string,
  payload: unknown,
) {
  if (table !== "forecast_policies" && table !== "forecast_results")
    throw new Error("Invalid forecast table");
  await tx.query(
    `INSERT INTO ${table}(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload`,
    [id, JSON.stringify(payload)],
  );
}
export async function forecastSkus(tx: Queryable): Promise<SkuDto[]> {
  return (
    await tx.query<{ payload: SkuDto }>("SELECT payload FROM skus ORDER BY id")
  ).rows.map((r) => r.payload);
}
export async function forecastPolicies(
  tx: Queryable,
  skus: SkuDto[],
): Promise<ForecastPolicy[]> {
  const saved = (
    await tx.query<{ payload: ForecastPolicy }>(
      "SELECT payload FROM forecast_policies ORDER BY id",
    )
  ).rows.map((r) => r.payload);
  return skus.map(
    (sku) =>
      saved.find((p) => p.skuId === sku.id) ?? {
        skuId: sku.id,
        minimumBoxes: sku.name
          .toLocaleLowerCase("ru")
          .replace(/[^а-яёa-z0-9]/g, "")
          .includes("новыйгод")
          ? 1
          : 0,
        seasonalityEnabled: true,
      },
  );
}
export async function forecastInputKey(
  tx: Queryable,
  m: MarketplaceState,
  skus: SkuDto[],
  policies: ForecastPolicy[],
  clock = new Date(),
): Promise<string> {
  const revision =
    (
      await tx.query<{ value: string }>(
        "SELECT value FROM metadata WHERE key=$1",
        ["forecast_history_revision"],
      )
    ).rows[0]?.value ?? "0";
  const stable = {
    version: FORECAST_MODEL_VERSION,
    planning: {
      version: UNIFIED_PLAN_VERSION,
      preparationDays: PREPARATION_DAYS,
    },
    asOf: forecastAsOf(clock),
    revision,
    resolutions: activeMarketplaceResolutions(m, clock)
      .map(
        ({
          id,
          revision,
          kind,
          provider,
          externalId,
          supplyId,
          skuId,
          donorProvider,
          expiresAt,
        }) => ({
          id,
          revision,
          kind,
          provider,
          externalId,
          supplyId,
          skuId,
          donorProvider,
          expiresAt,
        }),
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
    settings: {
      historyDays: m.settings.historyDays,
      horizonDays: m.settings.horizonDays,
      safetyDays: m.settings.safetyDays,
      leadDays: m.settings.leadDays,
      dispatchWeekday: m.settings.dispatchWeekday ?? 6,
    },
    connections: m.connections
      .filter((c) => c.enabled)
      .map((c) => ({
        provider: c.provider,
        version: c.version,
        storeId: c.historyStoreId ?? null,
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider)),
    snapshots: m.snapshots
      .filter((s) =>
        m.connections.some((c) => c.provider === s.provider && c.enabled),
      )
      .map((s) => ({
        provider: s.provider,
        asOf: s.asOf,
        from: s.from,
        to: s.to,
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider)),
    mappings: [...m.mappings].sort((a, b) =>
      `${a.provider}/${a.externalId}/${a.skuId}`.localeCompare(
        `${b.provider}/${b.externalId}/${b.skuId}`,
      ),
    ),
    skus: skus
      .map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        unitsPerBox: s.unitsPerBox,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    policies: [...policies].sort((a, b) => a.skuId.localeCompare(b.skuId)),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}
export async function forecastCache(tx: Queryable) {
  return (
    await tx.query<{ payload: ForecastCache }>(
      "SELECT payload FROM forecast_results WHERE id=$1",
      ["current"],
    )
  ).rows[0]?.payload;
}
export async function forecastLease(tx: Queryable) {
  return (
    await tx.query<{ payload: ForecastLease }>(
      "SELECT payload FROM forecast_results WHERE id=$1",
      ["lease"],
    )
  ).rows[0]?.payload;
}
/** Fast cached projection. Never fits a model or initiates historical loading. */
export async function readForecastPlanContext(
  tx: Queryable,
  m: MarketplaceState,
  clock = new Date(),
): Promise<ForecastPlanContext> {
  const skus = await forecastSkus(tx),
    policies = await forecastPolicies(tx, skus);
  const key = await forecastInputKey(tx, m, skus, policies, clock),
    cache = await forecastCache(tx);
  return {
    key,
    cacheCurrent: cache?.key === key,
    goals: cache?.key === key ? cache.goals : {},
    seasonalityEnabled: Object.fromEntries(
      policies.map((p) => [p.skuId, p.seasonalityEnabled]),
    ),
    minimumBoxes: Object.fromEntries(
      policies.map((p) => [p.skuId, p.minimumBoxes]),
    ),
  };
}
