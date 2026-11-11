import { createHash } from "node:crypto";
import { Queryable } from "./database";
import * as D from "./dto";

// A queued task reserves a quantity but nobody has taken its pallet into work.
function assemblyUsesPallets(task: D.TaskDto) {
  return task.status === "active" || task.status === "paused";
}

export function cellFingerprints(state: D.WorkspaceDto) {
  const result = new Map<string, string>();
  for (const l of state.locations) {
    const pallets = state.pallets
      .filter((p) => p.locationId === l.id && p.status !== "retired")
      .sort((a, b) => a.id.localeCompare(b.id));
    const palletIds = new Set(pallets.map((p) => p.id));
    const reservations = state.tasks
      .filter(assemblyUsesPallets)
      .flatMap((t) =>
        t.reservations
          .filter((r) => r.quantity > 0 && palletIds.has(r.palletId))
          .map((r) => ({ taskId: t.id, ...r })),
      )
      .sort(
        (a, b) =>
          a.taskId.localeCompare(b.taskId) ||
          a.palletId.localeCompare(b.palletId),
      );
    const movements = state.movements
      .filter(
        (m) =>
          ["planned", "in_transit"].includes(m.status) &&
          (m.fromLocationId === l.id || m.toLocationId === l.id),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    const putaways = state.putawayTasks
      .filter(
        (t) =>
          t.status !== "completed" &&
          (t.fromLocationId === l.id || t.toLocationId === l.id),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    const returns = state.pallets
      .filter((p) => p.returnLocationId === l.id)
      .map((p) => p.id)
      .sort();
    const boxes = state.boxes
      .filter((b) => b.status === "stored" && b.locationId === l.id)
      .sort((a, b) => a.id.localeCompare(b.id));
    const boxIds = new Set(boxes.map((b) => b.id));
    const shipments = state.shipments
      .filter(
        (s) => s.status === "draft" && s.boxIds.some((id) => boxIds.has(id)),
      )
      .map((s) => ({
        id: s.id,
        boxIds: s.boxIds.filter((id) => boxIds.has(id)).sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const section = state.sections.find((s) => s.id === l.sectionId);
    const address = {
      id: l.id,
      code: l.code,
      kind: l.kind,
      archived: l.archived,
      blocked: l.blocked,
      sectionArchived: section?.archived ?? false,
      availableWidthMm: l.availableWidthMm,
      availableDepthMm: l.availableDepthMm,
      maxHeightMm: l.maxHeightMm,
      maxBoxes: l.maxBoxes,
      maxWeightKg: l.maxWeightKg,
      accessSides: l.accessSides,
    };
    result.set(
      l.id,
      createHash("sha256")
        .update(
          JSON.stringify({
            address,
            pallets,
            boxes,
            reservations,
            movements,
            putaways,
            returns,
            shipments,
          }),
        )
        .digest("hex"),
    );
  }
  return result;
}
export async function advanceCellVersions(
  tx: Queryable,
  before: Map<string, string>,
  after: D.WorkspaceDto,
) {
  const next = cellFingerprints(after);
  for (const id of new Set([...before.keys(), ...next.keys()]))
    if (before.get(id) !== next.get(id))
      await tx.query(
        "INSERT INTO stocktake_cell_versions(location_id,version) VALUES($1,1) ON CONFLICT(location_id) DO UPDATE SET version=stocktake_cell_versions.version+1",
        [id],
      );
}
export async function cellVersions(
  tx: Queryable,
): Promise<Map<string, number>> {
  const result = await tx.query<{ location_id: string; version: string }>(
    "SELECT location_id,version FROM stocktake_cell_versions",
  );
  return new Map(result.rows.map((r) => [r.location_id, Number(r.version)]));
}
export function cellBusyReasons(state: D.WorkspaceDto, id: string): string[] {
  const reasons: string[] = [],
    location = state.locations.find((l) => l.id === id),
    section = state.sections.find((s) => s.id === location?.sectionId);
  if (!location || location.archived || section?.archived)
    reasons.push("Адрес находится в архиве или недоступен");
  if (location && !["rack", "floor"].includes(location.kind))
    reasons.push("Сверка поддерживает только адреса хранения: стеллаж и пол");
  if (location?.blocked) reasons.push("Адрес заблокирован");
  const pallets = state.pallets.filter(
      (p) => p.locationId === id && p.status !== "retired",
    ),
    palletIds = new Set(pallets.map((p) => p.id));
  if (
    state.tasks.some(
      (t) =>
        assemblyUsesPallets(t) &&
        t.reservations.some((r) => r.quantity > 0 && palletIds.has(r.palletId)),
    )
  )
    reasons.push("Паллета нужна для начатой сборки");
  if (
    state.movements.some(
      (m) =>
        ["planned", "in_transit"].includes(m.status) &&
        (m.fromLocationId === id || m.toLocationId === id),
    )
  )
    reasons.push("Адрес участвует в незавершённом перемещении паллеты");
  if (
    state.putawayTasks.some(
      (t) =>
        t.status !== "completed" &&
        (t.fromLocationId === id || t.toLocationId === id),
    )
  )
    reasons.push("Адрес участвует в незавершённом размещении короба");
  if (state.pallets.some((p) => p.returnLocationId === id))
    reasons.push("Адрес удерживается для возврата паллеты");
  const boxes = new Set(
    state.boxes
      .filter((b) => b.status === "stored" && b.locationId === id)
      .map((b) => b.id),
  );
  if (
    state.shipments.some(
      (s) => s.status === "draft" && s.boxIds.some((id) => boxes.has(id)),
    )
  )
    reasons.push("Короб зарезервирован черновиком отгрузки");
  return reasons;
}
export async function initializeStocktakes(
  tx: Queryable,
  state: D.WorkspaceDto,
) {
  await tx.query(
    "CREATE TABLE IF NOT EXISTS stocktake_cell_versions(location_id TEXT PRIMARY KEY,version BIGINT NOT NULL CHECK(version>=0))",
  );
  await tx.query(
    "CREATE TABLE IF NOT EXISTS stocktakes(id TEXT PRIMARY KEY,payload JSONB NOT NULL)",
  );
  await tx.query(
    "CREATE TABLE IF NOT EXISTS stocktake_rows(document_id TEXT NOT NULL REFERENCES stocktakes(id),location_id TEXT NOT NULL,payload JSONB NOT NULL,PRIMARY KEY(document_id,location_id))",
  );
  await tx.query(
    "CREATE TABLE IF NOT EXISTS stocktake_history(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES stocktakes(id),payload JSONB NOT NULL)",
  );
  await tx.query(
    "CREATE TABLE IF NOT EXISTS stocktake_commands(request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,response JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
  );
  await tx.query(
    `CREATE OR REPLACE FUNCTION reject_stocktake_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'stocktake_history is immutable'; END; $$`,
  );
  await tx.query(
    "DROP TRIGGER IF EXISTS stocktake_history_immutable ON stocktake_history",
  );
  await tx.query(
    "CREATE TRIGGER stocktake_history_immutable BEFORE UPDATE OR DELETE ON stocktake_history FOR EACH ROW EXECUTE FUNCTION reject_stocktake_history_mutation()",
  );
  for (const l of state.locations)
    await tx.query(
      "INSERT INTO stocktake_cell_versions(location_id,version) VALUES($1,0) ON CONFLICT(location_id) DO NOTHING",
      [l.id],
    );
}
