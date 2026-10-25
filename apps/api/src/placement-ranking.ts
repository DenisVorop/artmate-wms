import type * as D from "./dto";
import { placementRoutes, type PlacementRoute } from "./placement-routing";
type PlacementRow = {
  location: D.LocationDto;
  route: PlacementRoute;
  sameSkuPallet: boolean;
  levelPenaltyMeters: number;
  score: number | null;
};

/** Soft handling cost in equivalent walking metres, never a measured distance. */
export const EXTRA_LEVEL_COST_METERS = 12;
export function levelCostMeters(
  location: Pick<D.LocationDto, "kind" | "level">,
) {
  return location.kind === "rack"
    ? Math.max(0, location.level - 1) * EXTRA_LEVEL_COST_METERS
    : 0;
}
function activeSource(s: D.WorkspaceDto, id: string) {
  return s.locations.find(
    (l) =>
      l.id === id &&
      l.kind === "receiving" &&
      !l.archived &&
      !l.blocked &&
      (!l.sectionId ||
        s.sections.some((r) => r.id === l.sectionId && !r.archived)),
  );
}
/** A receipt has no physical address until placement. Never invent its start. */
export function receiptSourceLocation(
  s: D.WorkspaceDto,
  receiptId: string,
  palletId: string,
): string | null {
  const bindings = s.warehouse.zoneWork.filter(
    (b) =>
      b.jobKind === "receiving" &&
      b.jobId === receiptId &&
      b.palletId === palletId,
  );
  if (bindings.length) {
    if (bindings.length !== 1) return null;
    const zone = s.warehouse.workZones.find(
      (z) =>
        z.id === bindings[0].zoneId && z.kind === "receiving" && !z.archived,
    );
    if (!zone) return null;
    const ids = [...new Set(zone.locationIds)].filter((id) =>
      activeSource(s, id),
    );
    return ids.length === 1 ? ids[0] : null;
  }
  const locations = s.locations.filter((l) => activeSource(s, l.id));
  return locations.length === 1 ? locations[0].id : null;
}

export function rankPlacementLocations(
  s: D.WorkspaceDto,
  candidates: D.LocationDto[],
  sourceLocationId: string | null,
  finishedSkuId?: string,
) {
  const routes = placementRoutes(
    s,
    sourceLocationId,
    candidates.map((l) => l.id),
  );
  const existingSameSku = new Set(
    s.pallets
      .filter(
        (p) =>
          p.status === "stored" &&
          p.kind === "finished" &&
          p.skuId === finishedSkuId,
      )
      .map((p) => p.locationId),
  );
  const rows: PlacementRow[] = candidates.map((location) => {
    const route = routes.get(location.id) ?? {
      status: "unknown" as const,
      distanceMeters: null,
      note: "Не удалось определить маршрут по схеме склада.",
    };
    const levelPenaltyMeters = levelCostMeters(location);
    return {
      location,
      route,
      sameSkuPallet: !!finishedSkuId && existingSameSku.has(location.id),
      levelPenaltyMeters,
      score:
        route.distanceMeters === null
          ? null
          : route.distanceMeters + levelPenaltyMeters,
    };
  });
  const routeOrder = (status: string) =>
    status === "unreachable" ? 2 : status === "unknown" ? 1 : 0;
  rows.sort(
    (a, b) =>
      Number(a.route.status === "unreachable") -
        Number(b.route.status === "unreachable") ||
      Number(b.sameSkuPallet) - Number(a.sameSkuPallet) ||
      routeOrder(a.route.status) - routeOrder(b.route.status) ||
      (a.score !== null && b.score !== null
        ? a.score - b.score
        : a.levelPenaltyMeters - b.levelPenaltyMeters) ||
      a.location.maxHeightMm - b.location.maxHeightMm ||
      a.location.code.localeCompare(b.location.code) ||
      a.location.id.localeCompare(b.location.id),
  );
  const selected = rows.find((r) => r.route.status !== "unreachable");
  return {
    locations: rows.map((r) => r.location),
    suggestedLocationId: selected?.location.id ?? null,
    recommendation: selected
      ? recommendation(selected, sourceLocationId)
      : null,
    reason:
      candidates.length && !selected
        ? "По схеме не найден путь к подходящим адресам. Проверьте проходы и проёмы на карте."
        : null,
    rows,
  };
}
function recommendation(
  row: PlacementRow,
  sourceLocationId: string | null,
): D.PlacementRecommendationDto {
  const level =
    row.location.kind === "rack" ? Math.max(1, row.location.level) : 0;
  const distance =
    row.route.distanceMeters === null
      ? null
      : Math.round(row.route.distanceMeters * 10) / 10;
  const parts = [
    row.sameSkuPallet
      ? "В приоритете паллета этой тематики."
      : "Подобрано подходящее место хранения.",
  ];
  if (distance !== null)
    parts.push(
      `Путь по схеме около ${distance.toLocaleString("ru-RU")} м${row.route.status === "floor" ? "; в части помещений проходы не нанесены, использован свободный пол" : " по проходам"}.`,
    );
  else parts.push(row.route.note);
  parts.push(
    level > 1
      ? `Ярус ${level}: учтена дополнительная работа с подъёмом.`
      : level === 1
        ? "Первый ярус, без дополнительного подъёма."
        : "Напольное место, без дополнительного подъёма.",
  );
  return {
    locationId: row.location.id,
    sourceLocationId,
    routeStatus: row.route.status,
    distanceMeters: distance,
    level,
    levelPenaltyMeters: row.levelPenaltyMeters,
    sameSkuPallet: row.sameSkuPallet,
    explanation: parts.join(" "),
  };
}
