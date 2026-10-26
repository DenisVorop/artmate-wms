import { createHash, randomUUID } from "node:crypto";
import type { Queryable } from "../database";
import type { Connection, Mapping } from "../marketplaces/storage";
import type { MarketplaceSnapshot } from "../marketplaces/providers/types";
import type {
  ForecastHistorySeries,
  HistoryCoverage,
  HistoryFact,
  HistoryJob,
  HistorySource,
} from "./history-types";
const tables = [
  "forecast_history_facts",
  "forecast_history_coverage",
  "forecast_history_jobs",
  "forecast_history_pages",
  "forecast_stock_observations",
] as const;
export async function initializeForecastHistoryStorage(tx: Queryable) {
  await tx.query(
    "INSERT INTO metadata(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING",
    ["forecast_history_revision", "0"],
  );
  for (const table of tables)
    await tx.query(
      `CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,payload JSONB NOT NULL)`,
    );
}
export async function bumpForecastHistoryRevision(tx: Queryable) {
  await tx.query(
    "INSERT INTO metadata(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
    ["forecast_history_revision", randomUUID()],
  );
}
export async function historyPut(
  tx: Queryable,
  table: (typeof tables)[number],
  id: string,
  value: unknown,
) {
  if (!tables.includes(table)) throw new Error("Invalid history table");
  await tx.query(
    `INSERT INTO ${table}(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload`,
    [id, JSON.stringify(value)],
  );
}
export async function historyRows<T>(
  tx: Queryable,
  table: (typeof tables)[number],
): Promise<T[]> {
  if (!tables.includes(table)) throw new Error("Invalid history table");
  return (
    await tx.query<{ payload: T }>(`SELECT payload FROM ${table} ORDER BY id`)
  ).rows.map((r) => r.payload);
}
export function historyId(...parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
export function historyStore(c: Connection) {
  if (c.historyStoreId) return c.historyStoreId;
  return c.provider === "ozon" && c.clientId
    ? `ozon:${historyId(c.clientId)}`
    : `wildberries:${randomUUID()}`;
}
export async function archiveMarketplaceSnapshot(
  tx: Queryable,
  c: Connection,
  snapshot: MarketplaceSnapshot,
) {
  if (
    snapshot.provider !== c.provider ||
    !snapshot.coverage.catalog ||
    !snapshot.coverage.demand ||
    !snapshot.coverage.stocks ||
    c.lastSuccessVersion !== c.version
  )
    return;
  c.historyStoreId = historyStore(c);
  const storeId = c.historyStoreId,
    source = "operational_snapshot" as const;
  const snapshotHash = historyId(snapshot),
    coverageId = historyId(storeId, source, snapshot.from, snapshot.to);
  const previous = (
    await tx.query<{ payload: HistoryCoverage }>(
      "SELECT payload FROM forecast_history_coverage WHERE id=$1",
      [coverageId],
    )
  ).rows[0]?.payload;
  if (previous?.snapshotHash === snapshotHash) return;
  // An overlapping complete refresh replaces daily aggregates, including corrected cancellations and removed rows.
  await tx.query(
    "DELETE FROM forecast_history_facts WHERE payload->>'storeId'=$1 AND payload->>'source'=$2 AND payload->>'date'>=$3 AND payload->>'date'<=$4",
    [storeId, source, snapshot.from, snapshot.to],
  );
  for (const d of snapshot.demand) {
    if (d.date < snapshot.from || d.date > snapshot.to) continue;
    for (const metric of ["ordered", "cancelled"] as const) {
      const units = metric === "ordered" ? d.orderedUnits : d.cancelledUnits;
      if (!Number.isSafeInteger(units) || units < 0)
        throw new Error("Invalid history aggregate");
      const f: HistoryFact = {
        id: historyId(storeId, source, d.externalId, d.date, metric),
        storeId,
        provider: c.provider,
        externalId: d.externalId,
        date: d.date,
        metric,
        units,
        source,
        observedAt: snapshot.asOf,
      };
      await historyPut(tx, "forecast_history_facts", f.id, f);
    }
  }
  const coverage: HistoryCoverage = {
    storeId,
    provider: c.provider,
    from: snapshot.from,
    to: snapshot.to,
    source,
    observedAt: snapshot.asOf,
    snapshotHash,
  };
  await historyPut(
    tx,
    "forecast_history_coverage",
    historyId(storeId, source, snapshot.from, snapshot.to),
    coverage,
  );
  for (const p of snapshot.products) {
    const stocks = snapshot.stocks.filter((s) => s.externalId === p.externalId);
    const availableUnits =
      stocks.length && stocks.every((s) => s.availableUnits !== null)
        ? stocks.reduce((n, s) => n + s.availableUnits!, 0)
        : null;
    const observation = {
      storeId,
      provider: c.provider,
      externalId: p.externalId,
      date: new Date(Date.parse(snapshot.asOf) + 10800000)
        .toISOString()
        .slice(0, 10),
      observedAt: snapshot.asOf,
      availableUnits,
    };
    await historyPut(
      tx,
      "forecast_stock_observations",
      historyId(storeId, p.externalId, observation.date),
      observation,
    );
  }
  await bumpForecastHistoryRevision(tx);
}
export async function bootstrapForecastHistory(
  tx: Queryable,
  connections: Connection[],
  snapshots: MarketplaceSnapshot[],
) {
  for (const c of connections) {
    const s = snapshots.find((s) => s.provider === c.provider);
    if (!s || c.syncStatus !== "success" || c.lastSuccessVersion !== c.version)
      continue;
    await archiveMarketplaceSnapshot(tx, c, s);
    await tx.query(
      "UPDATE marketplace_connections SET payload=$2 WHERE id=$1",
      [c.provider, JSON.stringify(c)],
    );
  }
}
export async function loadForecastHistorySeries(
  tx: Queryable,
  mappings: Mapping[],
  asOf: string,
): Promise<ForecastHistorySeries[]> {
  const facts = await historyRows<HistoryFact>(tx, "forecast_history_facts"),
    coverage = await historyRows<HistoryCoverage>(
      tx,
      "forecast_history_coverage",
    ),
    observations = await historyRows<{
      storeId: string;
      provider: "ozon" | "wildberries";
      externalId: string;
      date: string;
      availableUnits: number | null;
    }>(tx, "forecast_stock_observations");
  const observationIndex = new Map(
    observations.map((o) => [`${o.storeId}/${o.externalId}/${o.date}`, o]),
  );
  const result: ForecastHistorySeries[] = [];
  const groups = new Map<string, HistoryFact[]>();
  for (const f of facts) {
    const k = historyId(f.storeId, f.externalId, f.metric);
    const group = groups.get(k);
    if (group) group.push(f);
    else groups.set(k, [f]);
  }
  // Catalog observation establishes existence from its observed day, never before launch.
  for (const o of observations)
    for (const metric of ["ordered", "cancelled"] as const) {
      const key = historyId(o.storeId, o.externalId, metric);
      const existing = groups.get(key);
      if (!existing)
        groups.set(key, [
          {
            id: "observed-catalog",
            storeId: o.storeId,
            provider: o.provider,
            externalId: o.externalId,
            date: o.date,
            metric,
            units: 0,
            source: "operational_snapshot",
            observedAt: o.date,
          },
        ]);
      else if (
        o.date < existing[0].date &&
        !existing.some((f) => f.id === "observed-catalog")
      )
        existing.push({
          id: "observed-catalog",
          storeId: o.storeId,
          provider: o.provider,
          externalId: o.externalId,
          date: o.date,
          metric,
          units: 0,
          source: "operational_snapshot",
          observedAt: o.date,
        });
    }
  for (const fs of groups.values()) {
    const first = fs[0],
      map = mappings.find(
        (m) =>
          m.provider === first.provider && m.externalId === first.externalId,
      );
    if (!map) continue;
    const starts = fs.map((f) => f.date).sort();
    const sums = new Map<string, number>();
    const eventDays = new Set<string>();
    for (const f of fs) {
      const key = `${f.date}/${f.source}`;
      sums.set(key, (sums.get(key) ?? 0) + f.units);
      eventDays.add(key);
    }
    const from = starts[0],
      to = asOf.slice(0, 10);
    const points: ForecastHistorySeries["points"] = [];
    for (
      let t = Date.parse(`${from}T00:00:00Z`);
      t < Date.parse(`${to}T00:00:00Z`);
      t += 86400000
    ) {
      const date = new Date(t).toISOString().slice(0, 10);
      const cs = coverage.filter(
        (c) =>
          c.storeId === first.storeId &&
          date >= c.from &&
          date <= c.to &&
          (first.metric === "sold" || first.metric === "returned"
            ? c.source === "wb_finance"
            : c.source !== "wb_finance"),
      );
      const source: HistorySource = cs.some(
        (c) => c.source === "operational_snapshot",
      )
        ? "operational_snapshot"
        : (cs[0]?.source ?? first.source);
      const financial = first.metric === "sold" || first.metric === "returned";
      const known = cs.some((c) => c.source === source);
      const dayKey = `${date}/${source}`;
      const stock = observationIndex.get(
        `${first.storeId}/${first.externalId}/${date}`,
      );
      points.push({
        date,
        units:
          known || (financial && eventDays.has(dayKey))
            ? (sums.get(dayKey) ?? 0) * map.unitsPerItem
            : null,
        availability:
          stock?.availableUnits === 0
            ? "out_of_stock"
            : stock?.availableUnits != null
              ? "available"
              : "unknown",
      });
    }
    result.push({
      skuId: map.skuId,
      provider: first.provider,
      storeId: first.storeId,
      externalId: first.externalId,
      metric: first.metric,
      source: first.source,
      points,
    });
  }
  return result;
}
export async function loadHistoryJobs(tx: Queryable) {
  return historyRows<HistoryJob>(tx, "forecast_history_jobs");
}
