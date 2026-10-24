"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getStockLedger } from "@/shared/api/generated/client";
import type { GetStockLedgerParams } from "@/shared/api/generated/model";
import { stockLedgerQueryKey } from "@/shared/api/query-keys";
export function useStockLedger(params: GetStockLedgerParams) {
  return useQuery({
    queryKey: [...stockLedgerQueryKey, params],
    queryFn: () => getStockLedger(params),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
    retry: 1,
  });
}
