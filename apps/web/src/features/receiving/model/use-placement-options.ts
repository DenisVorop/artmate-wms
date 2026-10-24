"use client";
import { useQuery } from "@tanstack/react-query";
import { getReceiptPlacementOptions } from "@/shared/api/generated/client";
export function usePlacementOptions(
  receiptId: string,
  palletId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["receipt-placement-options", receiptId, palletId],
    queryFn: () => getReceiptPlacementOptions(receiptId, palletId),
    enabled,
    staleTime: 0,
    refetchInterval: 5000,
    retry: 1,
  });
}
