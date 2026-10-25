"use client";

import { useQuery } from "@tanstack/react-query";
import { getWorkRoute } from "@/shared/api/generated/client";
import { getAuthEpoch, getAuthIdentityScope } from "@/shared/api/auth-memory";
import { workRouteRequestKey, type WorkRouteRequest } from "../lib/work-route";
import type { LocationMapData } from "../lib/location-map";
import {
  workRouteLayoutKey,
  workRouteLayoutPayload,
} from "../lib/map-layout-key";

export class RouteLayoutChangedError extends Error {}

/** Mounted only for an open map. A new task, layout or identity gets its own query. */
export function useWorkRoute(
  request: WorkRouteRequest | undefined,
  data: LocationMapData,
  contextKey: string,
) {
  const epoch = getAuthEpoch();
  const scope = getAuthIdentityScope();
  return useQuery({
    queryKey: [
      "employee-work-route",
      scope,
      epoch,
      contextKey,
      workRouteRequestKey(request),
      workRouteLayoutPayload(data),
    ],
    enabled: !!request,
    queryFn: async ({ signal }) => {
      const [route, layoutKey] = await Promise.all([
        getWorkRoute(request!, { signal }),
        workRouteLayoutKey(data),
      ]);
      if (getAuthEpoch() !== epoch || getAuthIdentityScope() !== scope)
        throw new Error("Сессия изменилась. Откройте карту заново.");
      if (route.layoutKey !== layoutKey)
        throw new RouteLayoutChangedError(
          "План склада изменился. Обновите маршрут.",
        );
      return { ...route, verifiedLayoutKey: layoutKey };
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchInterval: request ? 5000 : false,
  });
}
