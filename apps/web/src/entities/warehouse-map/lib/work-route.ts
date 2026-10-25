import type {
  GetWorkRouteParams,
  WorkRouteDto,
} from "@/shared/api/generated/model";
import {
  createLocationMap,
  type LocationMapData,
  type MapRectangle,
} from "./location-map";

export type WorkRouteRequest = GetWorkRouteParams;

export function workRouteRequestKey(request?: WorkRouteRequest) {
  return request
    ? JSON.stringify([
        request.kind,
        request.id,
        request.palletId ?? null,
        request.boxId ?? null,
      ])
    : "none";
}

/** Fit the complete path, including detours, and the two actual footprints. */
export function workRouteBounds(
  points: { x: number; y: number }[],
  footprints: MapRectangle[],
): MapRectangle {
  const all = [
    ...points.map((point) => ({ ...point, width: 0, depth: 0 })),
    ...footprints,
  ];
  const left = Math.min(...all.map((item) => item.x));
  const top = Math.min(...all.map((item) => item.y));
  const right = Math.max(...all.map((item) => item.x + item.width));
  const bottom = Math.max(...all.map((item) => item.y + item.depth));
  const padding = Math.max(0.6, Math.min(right - left, bottom - top) * 0.08);
  return {
    x: left - padding,
    y: top - padding,
    width: right - left + padding * 2,
    depth: bottom - top + padding * 2,
  };
}

export function createWorkRouteMap(
  data: LocationMapData,
  route: WorkRouteDto,
  currentLayoutKey: string,
  currentEndpoint?: {
    intent: "take" | "place";
    locationId: string | null | undefined;
  },
) {
  if (route.layoutKey !== currentLayoutKey)
    return {
      available: false as const,
      reason: "layout" as const,
      message: "План или задание изменились. Обновляем маршрут…",
    };
  if (
    currentEndpoint?.locationId &&
    (currentEndpoint.intent === "take"
      ? route.sourceLocationId
      : route.targetLocationId) !== currentEndpoint.locationId
  )
    return {
      available: false as const,
      reason: "work" as const,
      message: "Адрес задания изменился. Дождитесь обновления рабочего экрана.",
    };
  const source = createLocationMap(data, route.sourceLocationId);
  const destination = createLocationMap(data, route.targetLocationId);
  if (!source.available || !destination.available)
    return {
      available: false as const,
      reason: "address" as const,
      message:
        "Один из адресов недоступен на карте. Уточните место у руководителя.",
    };
  const reachable = route.status === "aisles" || route.status === "floor";
  const validPoints =
    route.points.length >= 2 &&
    route.points.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    );
  return {
    available: true as const,
    layoutKey: route.layoutKey,
    source,
    destination,
    line: reachable && validPoints ? route.points : null,
    bounds: workRouteBounds(reachable && validPoints ? route.points : [], [
      source.target,
      destination.target,
    ]),
  };
}
