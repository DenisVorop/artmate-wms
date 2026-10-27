import {
  initializePlanningStockStorage,
  type PlanningStockConfirmation,
} from "./planning-stock";
import {
  initializeMarketplaceResolutionStorage,
  type MarketplaceResolution,
} from "./planning-resolutions";
import { Queryable } from "../database";
import { MarketplaceSnapshot, MarketplaceProvider } from "./providers/types";
import { MarketplaceSettingsDto } from "./dto";
export interface Connection {
  provider: MarketplaceProvider;
  encrypted: string;
  clientId: string | null;
  enabled: boolean;
  version: number;
  syncStatus: "never" | "running" | "success" | "failed" | "partial";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  message: string | null;
  warnings: string[];
  runId: string | null;
  syncMode?: "manual" | "automatic";
  lastSuccessVersion?: number;
  historyStoreId?: string;
  financeEncrypted?: string;
  financeVersion?: number;
  historySellerId?: string;
  historyLease?: { runId: string; until: string };
}
export interface Mapping {
  provider: MarketplaceProvider;
  externalId: string;
  skuId: string;
  unitsPerItem: number;
}
export interface MarketplaceState {
  connections: Connection[];
  snapshots: MarketplaceSnapshot[];
  mappings: Mapping[];
  transit: Record<string, number>;
  settings: MarketplaceSettingsDto;
  planningStock?: PlanningStockConfirmation[];
  resolutions?: MarketplaceResolution[];
}
export const defaultSettings: MarketplaceSettingsDto = {
  horizonDays: 14,
  safetyDays: 3,
  leadDays: 7,
  historyDays: 28,
  dispatchWeekday: 6,
};
export async function initializeMarketplaceStorage(tx: Queryable) {
  await initializePlanningStockStorage(tx);
  await initializeMarketplaceResolutionStorage(tx);
  for (const table of [
    "marketplace_connections",
    "marketplace_snapshots",
    "marketplace_mappings",
    "marketplace_settings",
    "marketplace_transit",
    "marketplace_task_origins",
  ])
    await tx.query(
      `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, payload JSONB NOT NULL)`,
    );
}
export async function put(
  tx: Queryable,
  table: string,
  id: string,
  payload: unknown,
) {
  if (
    ![
      "marketplace_connections",
      "marketplace_snapshots",
      "marketplace_mappings",
      "marketplace_settings",
      "marketplace_transit",
      "marketplace_task_origins",
    ].includes(table)
  )
    throw new Error("Invalid marketplace table");
  await tx.query(
    `INSERT INTO ${table}(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload`,
    [id, JSON.stringify(payload)],
  );
}
export async function loadMarketplaces(
  tx: Queryable,
): Promise<MarketplaceState> {
  const rows = async <T>(table: string) =>
    (
      await tx.query<{ payload: T }>(`SELECT payload FROM ${table} ORDER BY id`)
    ).rows.map((r) => r.payload);
  const settings = await rows<MarketplaceSettingsDto>("marketplace_settings");
  return {
    connections: await rows<Connection>("marketplace_connections"),
    snapshots: await rows<MarketplaceSnapshot>("marketplace_snapshots"),
    mappings: await rows<Mapping>("marketplace_mappings"),
    transit: Object.fromEntries(
      (await rows<{ skuId: string; units: number }>("marketplace_transit")).map(
        (r) => [r.skuId, r.units],
      ),
    ),
    settings: { ...defaultSettings, ...settings[0] },
    resolutions: await rows<MarketplaceResolution>("marketplace_resolutions"),
    planningStock: await rows<PlanningStockConfirmation>(
      "planning_stock_confirmations",
    ),
  };
}
