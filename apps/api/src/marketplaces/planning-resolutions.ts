import { createHash } from "node:crypto";
import type { Queryable } from "../database";
import type {
  MarketplaceProvider,
  MarketplaceSnapshot,
} from "./providers/types";
import type { Connection, MarketplaceState } from "./storage";

export interface MarketplaceResolution {
  id: string;
  kind: "exclude_supply" | "zero_stock" | "launch";
  provider: MarketplaceProvider;
  storeId: string;
  connectionVersion: number;
  externalId?: string;
  supplyId?: string;
  skuId?: string;
  enabled: boolean;
  note: string;
  donorProvider?: MarketplaceProvider;
  donorStoreId?: string;
  donorConnectionVersion?: number;
  confirmedAt: string;
  expiresAt: string | null;
  actorAccountId: string;
  revision: number;
}
export function marketplaceResolutionId(
  entry: Pick<
    MarketplaceResolution,
    "storeId" | "provider" | "kind" | "externalId" | "supplyId"
  >,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        entry.provider,
        entry.storeId,
        entry.kind,
        entry.supplyId ?? entry.externalId,
      ]),
    )
    .digest("hex");
}
export function activeMarketplaceResolutions(
  m: MarketplaceState,
  clock = new Date(),
) {
  return (m.resolutions ?? []).filter((r) => {
    const connection = m.connections.find((c) => c.provider === r.provider);
    return (
      r.enabled &&
      connection?.enabled &&
      connection.historyStoreId === r.storeId &&
      connection.version === r.connectionVersion &&
      (r.expiresAt === null || Date.parse(r.expiresAt) > clock.getTime()) &&
      (r.kind !== "launch" ||
        m.connections.some(
          (donor) =>
            donor.enabled &&
            donor.provider === r.donorProvider &&
            donor.historyStoreId === r.donorStoreId &&
            donor.version === r.donorConnectionVersion &&
            m.mappings.some(
              (mapping) =>
                mapping.provider === donor.provider &&
                mapping.skuId === r.skuId,
            ),
        )) &&
      (r.kind === "exclude_supply" ||
        m.mappings.some(
          (mapping) =>
            mapping.provider === r.provider &&
            mapping.externalId === r.externalId &&
            mapping.skuId === r.skuId,
        ))
    );
  });
}
/** Manager facts alter the planning projection only. Imported snapshots remain immutable evidence. */
export function applyMarketplaceResolutions(
  m: MarketplaceState,
  clock = new Date(),
): MarketplaceState {
  const result = structuredClone(m);
  for (const resolution of activeMarketplaceResolutions(m, clock)) {
    const connection = m.connections.find(
      (c) => c.provider === resolution.provider,
    )!;
    const snapshot = result.snapshots.find(
      (s) => s.provider === resolution.provider,
    );
    if (!snapshot) continue;
    if (resolution.kind === "zero_stock") {
      if (
        !snapshot.coverage.stocks ||
        !snapshot.coverage.catalog ||
        connection.lastSuccessVersion !== connection.version ||
        !snapshot.products.some((p) => p.externalId === resolution.externalId)
      )
        continue;
      const stocks = snapshot.stocks.filter(
        (s) => s.externalId === resolution.externalId,
      );
      // A numeric API observation, including zero, always wins over a manager confirmation.
      if (stocks.some((s) => s.availableUnits !== null)) continue;
      snapshot.stocks = snapshot.stocks.filter(
        (s) => s.externalId !== resolution.externalId,
      );
      snapshot.stocks.push({
        externalId: resolution.externalId!,
        warehouseId: "confirmed-zero",
        warehouseName: "Подтверждённое отсутствие товара",
        availableUnits: 0,
        reservedUnits: 0,
        inboundUnits: null,
      });
    }
    if (
      resolution.kind === "exclude_supply" &&
      snapshot.provider === "wildberries"
    ) {
      const supply = snapshot.supplies?.find(
        (s) => s.id === resolution.supplyId,
      );
      if (!supply) continue;
      supply.calculation = "excluded";
      supply.warnings = [
        `Исключена из ожидаемых поступлений: ${resolution.note}`,
      ];
    }
  }
  // Recompute only products touched by a matching exclusion. Other unknown observations stay unknown.
  for (const snapshot of result.snapshots) {
    if (
      snapshot.provider !== "wildberries" ||
      !snapshot.supplies ||
      !snapshot.inbound
    )
      continue;
    const excludedIds = new Set(
      activeMarketplaceResolutions(m, clock)
        .filter(
          (r) =>
            r.provider === snapshot.provider && r.kind === "exclude_supply",
        )
        .map((r) => r.supplyId),
    );
    const affected = new Set(
      snapshot.supplies
        .filter((s) => excludedIds.has(s.id))
        .flatMap((s) => s.items.map((i) => i.externalId)),
    );
    for (const inbound of snapshot.inbound) {
      if (!affected.has(inbound.externalId)) continue;
      const remaining = snapshot.supplies
        .filter((s) => s.calculation !== "excluded")
        .flatMap((s) =>
          s.items
            .filter((i) => i.externalId === inbound.externalId)
            .map((item) => ({ supply: s, item })),
        );
      const total = remaining.reduce<number | null>(
        (sum, { item }) =>
          sum === null || item.pendingUnits === null
            ? null
            : sum + item.pendingUnits,
        0,
      );
      inbound.units =
        total !== null && Number.isSafeInteger(total) ? total : null;
      inbound.supplyIds = [
        ...new Set(
          remaining
            .filter(
              ({ item }) => item.pendingUnits === null || item.pendingUnits > 0,
            )
            .map(({ supply }) => supply.id),
        ),
      ];
      inbound.warnings = [
        ...new Set(remaining.flatMap(({ supply }) => supply.warnings)),
      ];
    }
    snapshot.coverage.inbound = snapshot.inbound.every(
      (entry) => entry.units !== null,
    );
  }
  return result;
}
export async function initializeMarketplaceResolutionStorage(tx: Queryable) {
  await tx.query(
    "CREATE TABLE IF NOT EXISTS marketplace_resolutions(id TEXT PRIMARY KEY,payload JSONB NOT NULL)",
  );
  await tx.query(
    "CREATE TABLE IF NOT EXISTS marketplace_resolution_events(id TEXT PRIMARY KEY,payload JSONB NOT NULL)",
  );
  await tx.query(
    "CREATE OR REPLACE FUNCTION reject_marketplace_resolution_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'marketplace resolution events are immutable'; END; $$",
  );
  await tx.query(
    "DROP TRIGGER IF EXISTS marketplace_resolution_events_immutable ON marketplace_resolution_events",
  );
  await tx.query(
    "CREATE TRIGGER marketplace_resolution_events_immutable BEFORE UPDATE OR DELETE ON marketplace_resolution_events FOR EACH ROW EXECUTE FUNCTION reject_marketplace_resolution_event_mutation()",
  );
}
export async function saveMarketplaceResolution(
  tx: Queryable,
  entry: MarketplaceResolution,
) {
  await tx.query(
    "INSERT INTO marketplace_resolutions(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload",
    [entry.id, JSON.stringify(entry)],
  );
}
/** Publishing a positive API observation permanently supersedes an earlier zero; a later outage cannot revive it. */
export async function supersedePositiveStockResolutions(
  tx: Queryable,
  connection: Connection,
  snapshot: MarketplaceSnapshot,
) {
  const rows = (
    await tx.query<{ payload: MarketplaceResolution }>(
      "SELECT payload FROM marketplace_resolutions ORDER BY id",
    )
  ).rows;
  for (const { payload: previous } of rows) {
    if (
      !previous.enabled ||
      previous.kind !== "zero_stock" ||
      previous.provider !== connection.provider ||
      previous.storeId !== connection.historyStoreId ||
      previous.connectionVersion !== connection.version ||
      !snapshot.stocks.some(
        (s) =>
          s.externalId === previous.externalId &&
          s.availableUnits !== null &&
          s.availableUnits > 0,
      )
    )
      continue;
    const current = {
      ...previous,
      enabled: false,
      revision: previous.revision + 1,
    };
    await saveMarketplaceResolution(tx, current);
    await tx.query(
      "INSERT INTO marketplace_resolution_events(id,payload) VALUES($1,$2)",
      [
        `${current.id}:${current.revision}`,
        JSON.stringify({
          previous,
          current,
          recordedAt: new Date().toISOString(),
          actorAccountId: null,
          reason: "API подтвердил положительный остаток",
          source: "marketplace_sync",
        }),
      ],
    );
  }
}
