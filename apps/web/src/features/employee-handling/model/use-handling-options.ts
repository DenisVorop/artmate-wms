"use client";
import { useQuery } from "@tanstack/react-query";
import {
  getPutawayPlacementOptions,
  getReceiptPlacementOptions,
} from "@/shared/api/generated/client";
import { getAuthEpoch, getAuthIdentityScope } from "@/shared/api/auth-memory";
export function useHandlingOptions(
  kind: "putaway" | "receiving",
  id: string,
  palletId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      "employee-handling-options",
      getAuthIdentityScope(),
      kind,
      id,
      palletId,
    ],
    queryFn: async ({ signal }) => {
      const epoch = getAuthEpoch();
      const result =
        kind === "putaway"
          ? await getPutawayPlacementOptions(id, { signal })
          : await getReceiptPlacementOptions(id, palletId, { signal });
      if (signal.aborted || epoch !== getAuthEpoch())
        throw new Error("Сессия изменилась. Обновите рабочее место.");
      return result;
    },
    enabled: enabled && !!id,
    staleTime: 0,
    refetchInterval: 5000,
    retry: 1,
  });
}
