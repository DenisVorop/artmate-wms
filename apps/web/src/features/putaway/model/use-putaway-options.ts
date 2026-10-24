"use client";
import { useQuery } from "@tanstack/react-query";
import { getPutawayPlacementOptions } from "@/shared/api/generated/client";
export function usePutawayOptions(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["putaway-placement-options", id],
    queryFn: () => getPutawayPlacementOptions(id),
    enabled,
    staleTime: 0,
    refetchInterval: 5000,
    retry: 1,
  });
}
