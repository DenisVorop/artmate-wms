"use client";
import { useQuery } from "@tanstack/react-query";
import { getReceiptLabels } from "@/shared/api/generated/client";

export function useReceiptLabels(id: string) {
  return useQuery({
    queryKey: ["receipt-labels", id],
    queryFn: () => getReceiptLabels(id),
    enabled: !!id,
    retry: 1,
  });
}
