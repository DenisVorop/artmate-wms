import { activeMarketplaceResolutions } from "./planning-resolutions";
import { createHash } from "node:crypto";
import type { Queryable } from "../database";
import type { WorkspaceDto } from "../dto";
import { FORECAST_MODEL_VERSION } from "../forecasting/engine";
import {
  putForecast,
  type ForecastPlanContext,
} from "../forecasting/forecast-storage";
import type { MarketplacePlanDto } from "./dto";
import { marketplacePlan } from "./planning";
import type { MarketplaceState } from "./storage";
import { PREPARATION_DAYS, UNIFIED_PLAN_VERSION } from "./unified-plan";

interface SavedPlanningPresentation {
  compatibilityKey: string;
  plan: MarketplacePlanDto;
  dataUpdatedAt: string | null;
  salesThrough: string | null;
}
export interface PlanningPresentation {
  previousPlan: MarketplacePlanDto | null;
  planStatus: {
    state: "current" | "refreshing" | "previous" | "unavailable";
    calculatedAt: string | null;
    dataUpdatedAt: string | null;
    salesThrough: string | null;
    message: string;
  };
}
const cacheId = "marketplace_plan_display";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Identity/configuration binding; a new day or a new import is not a new shop. */
export function planningPresentationKey(
  w: WorkspaceDto,
  m: MarketplaceState,
  forecast: ForecastPlanContext,
  clock = new Date(),
) {
  return hash({
    version: 2,
    resolutions: activeMarketplaceResolutions(m, clock)
      .map(({ id, revision }) => ({ id, revision }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    model: FORECAST_MODEL_VERSION,
    planning: UNIFIED_PLAN_VERSION,
    preparationDays: PREPARATION_DAYS,
    connections: m.connections
      .map((c) => ({
        provider: c.provider,
        enabled: c.enabled,
        version: c.version,
        storeId: c.historyStoreId ?? null,
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider)),
    mappings: [...m.mappings].sort((a, b) =>
      `${a.provider}/${a.externalId}`.localeCompare(
        `${b.provider}/${b.externalId}`,
      ),
    ),
    settings: m.settings,
    skus: w.skus
      .map((sku) => ({
        id: sku.id,
        code: sku.code,
        name: sku.name,
        unitsPerBox: sku.unitsPerBox,
        enabled:
          m.planningStock?.find((p) => p.skuId === sku.id)?.enabled !== false,
        minimumBoxes: forecast.minimumBoxes[sku.id] ?? 0,
        seasonalityEnabled: forecast.seasonalityEnabled?.[sku.id] ?? true,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

function sourceDates(m: MarketplaceState) {
  const snapshots = m.snapshots.filter((s) =>
    m.connections.some((c) => c.enabled && c.provider === s.provider),
  );
  return {
    // The oldest source describes the age of the complete joint calculation.
    dataUpdatedAt: snapshots.map((s) => s.asOf).sort()[0] ?? null,
    salesThrough: snapshots.map((s) => s.to).sort()[0] ?? null,
  };
}
function nonExecutable(plan: MarketplacePlanDto): MarketplacePlanDto {
  const previous = structuredClone(plan);
  for (const row of previous.rows) {
    row.canCreate = false;
    row.backlogCanCreate = false;
    row.backlogReason = "Дождитесь обновления расчёта.";
    row.advice = {
      ...row.advice,
      message: row.dataComplete
        ? "Показан сохранённый расчёт. Обновление идёт в фоне."
        : row.advice.message,
      action: ["create", "receiving"].includes(row.advice.action)
        ? "none"
        : row.advice.action,
    };
  }
  return previous;
}

/** Called only after manager authorization. No network, fitting, or warehouse writes. */
export async function readPlanningPresentation(
  tx: Queryable,
  w: WorkspaceDto,
  m: MarketplaceState,
  clock: Date,
  forecast: ForecastPlanContext,
  strictPlan: MarketplacePlanDto,
): Promise<PlanningPresentation> {
  const compatibilityKey = planningPresentationKey(w, m, forecast, clock);
  const cached = (
    await tx.query<{ payload: SavedPlanningPresentation }>(
      "SELECT payload FROM forecast_results WHERE id=$1",
      [cacheId],
    )
  ).rows[0]?.payload;
  let saved =
    cached?.compatibilityKey === compatibilityKey ? cached : undefined;
  const running = m.connections.some(
    (c) => c.enabled && c.syncStatus === "running",
  );
  const enabled = m.connections.filter((c) => c.enabled);
  const verifiedSources =
    enabled.length > 0 &&
    enabled.every((c) => c.lastSuccessVersion === c.version);
  const current =
    verifiedSources &&
    forecast.cacheCurrent !== false &&
    strictPlan.rows.some((row) => row.dataComplete);
  const dates = sourceDates(m);
  if (current) {
    const next: SavedPlanningPresentation = {
      compatibilityKey,
      plan: strictPlan,
      ...dates,
    };
    const content = (entry: SavedPlanningPresentation) => ({
      ...entry,
      plan: { ...entry.plan, generatedAt: "" },
    });
    if (!saved || hash(content(saved)) !== hash(content(next)))
      await putForecast(tx, "forecast_results", cacheId, next);
    return {
      previousPlan: null,
      planStatus: {
        state: running ? "refreshing" : "current",
        calculatedAt: strictPlan.generatedAt,
        ...dates,
        message: running
          ? "Данные обновляются в фоне. Расчёт остаётся доступным."
          : "Расчёт по последним загруженным данным.",
      },
    };
  }
  let reconstructed = false;
  if (!saved) {
    // Complete last-success snapshots can seed the read model after this feature
    // is installed. Replaced credentials never qualify, even if an old snapshot
    // is still physically retained in storage.
    if (verifiedSources) {
      const restored = marketplacePlan(w, m, clock, forecast, {
        savedSnapshots: true,
      });
      if (restored.rows.some((row) => row.dataComplete)) {
        saved = { compatibilityKey, plan: restored, ...dates };
        await putForecast(tx, "forecast_results", cacheId, saved);
        reconstructed = true;
      }
    }
  }
  if (saved)
    return {
      previousPlan: nonExecutable(saved.plan),
      planStatus: {
        state:
          running || forecast.cacheCurrent === false
            ? "refreshing"
            : "previous",
        calculatedAt: saved.plan.generatedAt,
        dataUpdatedAt: saved.dataUpdatedAt,
        salesThrough: saved.salesThrough,
        message: reconstructed
          ? "Расчёт по последним сохранённым данным. Обновление идёт в фоне."
          : running || forecast.cacheCurrent === false
            ? "Показан предыдущий расчёт. Обновление идёт в фоне."
            : "Показан предыдущий расчёт. Повторяем обновление автоматически.",
      },
    };
  return {
    previousPlan: null,
    planStatus: {
      state: "unavailable",
      calculatedAt: null,
      ...dates,
      message:
        "Пока нет полного расчёта. Дождитесь загрузки данных или проверьте товары.",
    },
  };
}
