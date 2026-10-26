"use client";
import { useQuery } from "@tanstack/react-query";
import {
  getForecastOverview,
  getForecastHistory,
} from "@/shared/api/generated/client";
import { getAuthEpoch, getAuthIdentityScope } from "@/shared/api/auth-memory";
export function useForecast(enabled: boolean) {
  const epoch = getAuthEpoch(),
    scope = getAuthIdentityScope();
  return useQuery({
    queryKey: ["forecast", scope, epoch],
    enabled,
    queryFn: async ({ signal }) => {
      const data = await getForecastOverview({ signal });
      if (getAuthEpoch() !== epoch || getAuthIdentityScope() !== scope)
        throw new Error("Сессия изменилась");
      return data;
    },
    refetchInterval: 30000,
    retry: 1,
  });
}
export function useForecastHistory(enabled: boolean) {
  const epoch = getAuthEpoch(),
    scope = getAuthIdentityScope();
  return useQuery({
    queryKey: ["forecast-history", scope, epoch],
    enabled,
    queryFn: async ({ signal }) => {
      const data = await getForecastHistory({ signal });
      if (getAuthEpoch() !== epoch || getAuthIdentityScope() !== scope)
        throw new Error("Сессия изменилась");
      return data;
    },
    refetchInterval: 15000,
    retry: 1,
  });
}
