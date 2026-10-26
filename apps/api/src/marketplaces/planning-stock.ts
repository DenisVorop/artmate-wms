import { createHash } from "node:crypto";
import type { Queryable } from "../database";
import type { WorkspaceDto } from "../dto";
import type { MarketplaceState } from "./storage";
export interface PlanningStockConfirmation {
  skuId: string;
  enabled: boolean;
  units: number | null;
  accuracy: "exact" | "approximate";
  note: string;
  unitsPerBoxAtCount: number;
  trackedUnitsAtCount: number;
  countedAt: string;
  actorAccountId: string;
  revision: number;
  outboundSupplyKeys: string[];
}
/** This projection does not create physical inventory or grant shipping/FIFO availability. */
export function trackedFinishedUnits(w: WorkspaceDto, skuId: string) {
  return w.boxes
    .filter(
      (b) => b.skuId === skuId && ["stored", "in_transit"].includes(b.status),
    )
    .reduce((n, b) => n + b.units, 0);
}
export function outgoingSupplyKeys(m: MarketplaceState, skuId: string) {
  const enabled = new Set(
      m.connections.filter((c) => c.enabled).map((c) => c.provider),
    ),
    result = new Set<string>();
  for (const snapshot of m.snapshots) {
    if (!enabled.has(snapshot.provider)) continue;
    const mappings = new Map(
      m.mappings
        .filter((x) => x.provider === snapshot.provider && x.skuId === skuId)
        .map((x) => [x.externalId, x.unitsPerItem]),
    );
    for (const doc of snapshot.supplies ?? []) {
      if (doc.calculation === "excluded" && doc.statusCode !== "COMPLETED")
        continue;
      const composition = new Map<
        string,
        { externalId: string; multiplier: number; planned: number | null }
      >();
      for (const item of doc.items) {
        const multiplier = mappings.get(item.externalId);
        if (multiplier === undefined) continue;
        const previous = composition.get(item.externalId);
        const planned = previous
          ? previous.planned === null || item.plannedUnits === null
            ? null
            : previous.planned + item.plannedUnits
          : item.plannedUnits;
        composition.set(item.externalId, {
          externalId: item.externalId,
          multiplier,
          planned:
            planned !== null && Number.isSafeInteger(planned) ? planned : null,
        });
      }
      if (!composition.size) continue;
      const tuples = [...composition.values()]
        .sort((a, b) => a.externalId.localeCompare(b.externalId))
        .map((x) => [x.externalId, x.multiplier, x.planned]);
      const hash = createHash("sha256")
        .update(JSON.stringify(tuples))
        .digest("hex");
      result.add(`${snapshot.provider}:${doc.id}:${hash}`);
    }
  }
  return [...result].sort();
}
export async function initializePlanningStockStorage(tx: Queryable) {
  await tx.query(
    "CREATE TABLE IF NOT EXISTS planning_stock_confirmations(id TEXT PRIMARY KEY,payload JSONB NOT NULL)",
  );
  await tx.query(
    "CREATE TABLE IF NOT EXISTS planning_stock_confirmation_events(id TEXT PRIMARY KEY,payload JSONB NOT NULL)",
  );
  await tx.query(
    "CREATE OR REPLACE FUNCTION reject_planning_stock_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'planning stock confirmation events are immutable'; END; $$",
  );
  await tx.query(
    "DROP TRIGGER IF EXISTS planning_stock_events_immutable ON planning_stock_confirmation_events",
  );
  await tx.query(
    "CREATE TRIGGER planning_stock_events_immutable BEFORE UPDATE OR DELETE ON planning_stock_confirmation_events FOR EACH ROW EXECUTE FUNCTION reject_planning_stock_event_mutation()",
  );
}
export async function savePlanningStock(
  tx: Queryable,
  entry: PlanningStockConfirmation,
) {
  await tx.query(
    "INSERT INTO planning_stock_confirmations(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload",
    [entry.skuId, JSON.stringify(entry)],
  );
}
