"use client";
import { useQuery } from "@tanstack/react-query";
import { getMarketplaces } from "@/shared/api/generated/client";
import { getAuthEpoch, getAuthIdentityScope } from "@/shared/api/auth-memory";

export function useMarketplaces(enabled: boolean) {
  const epoch = getAuthEpoch(),
    scope = getAuthIdentityScope();
  return useQuery({
    queryKey: ["marketplaces", scope, epoch],
    enabled,
    queryFn: async ({ signal }) => {
      const data = await getMarketplaces({ signal });
      if (getAuthEpoch() !== epoch || getAuthIdentityScope() !== scope)
        throw new Error("Сессия изменилась. Откройте раздел заново.");
      return data;
    },
    refetchInterval: 30000,
    retry: 1,
  });
}
