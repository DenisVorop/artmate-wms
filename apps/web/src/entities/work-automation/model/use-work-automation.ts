"use client";
import { useQuery } from "@tanstack/react-query";
import { getWorkAutomation } from "@/shared/api/generated/client";
import { getAuthEpoch, getAuthIdentityScope } from "@/shared/api/auth-memory";

export type WorkAutomationStatus = Awaited<
  ReturnType<typeof getWorkAutomation>
>;
export function useWorkAutomation(enabled: boolean) {
  const epoch = getAuthEpoch(),
    scope = getAuthIdentityScope();
  return useQuery({
    queryKey: ["work-automation", scope, epoch],
    enabled,
    queryFn: async ({ signal }) => {
      const status = await getWorkAutomation({ signal });
      if (epoch !== getAuthEpoch() || scope !== getAuthIdentityScope())
        throw new Error("Сессия изменилась");
      return status;
    },
    refetchInterval: 5000,
    retry: 1,
  });
}
