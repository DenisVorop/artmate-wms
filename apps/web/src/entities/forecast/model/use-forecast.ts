"use client";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import {
  getForecastOverview,
  getForecastJournal,
  getForecastJournalRun,
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

export function useForecastJournal(enabled: boolean) {
  const epoch = getAuthEpoch(),
    scope = getAuthIdentityScope();
  return useInfiniteQuery({
    queryKey: ["forecast-journal", scope, epoch],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const data = await getForecastJournal(
        { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) },
        { signal },
      );
      if (getAuthEpoch() !== epoch || getAuthIdentityScope() !== scope)
        throw new Error("Сессия изменилась");
      return data;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 60000,
    retry: 1,
  });
}
export function useForecastJournalRun(id: string, enabled: boolean) {
  const epoch = getAuthEpoch(),
    scope = getAuthIdentityScope();
  return useQuery({
    queryKey: ["forecast-journal-run", scope, epoch, id],
    enabled: enabled && !!id,
    queryFn: async ({ signal }) => {
      const data = await getForecastJournalRun(id, { signal });
      if (getAuthEpoch() !== epoch || getAuthIdentityScope() !== scope)
        throw new Error("Сессия изменилась");
      return data;
    },
    refetchInterval: 60000,
    retry: 1,
  });
}
