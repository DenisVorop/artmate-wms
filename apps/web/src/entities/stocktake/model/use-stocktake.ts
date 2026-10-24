"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getStocktakes,
  getStocktake,
  getStocktakePreview,
} from "@/shared/api/generated/client";
import type { GetStocktakesParams } from "@/shared/api/generated/model";
import { stocktakeQueryKey } from "@/shared/api/query-keys";

export const stocktakeDocumentKey = (id: string) =>
  [...stocktakeQueryKey, "document", id] as const;
export function useStocktakes(params: GetStocktakesParams = {}) {
  return useQuery({
    queryKey: [...stocktakeQueryKey, "list", params],
    queryFn: ({ signal }) => getStocktakes(params, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
    retry: 1,
  });
}
export function useStocktake(id: string, enabled = true) {
  return useQuery({
    queryKey: stocktakeDocumentKey(id),
    queryFn: ({ signal }) => getStocktake(id, { signal }),
    enabled: !!id && enabled,
    refetchInterval: 5000,
    retry: 1,
  });
}
export function useStocktakePreview(id: string, enabled = true) {
  return useQuery({
    queryKey: [...stocktakeQueryKey, "preview", id],
    queryFn: ({ signal }) => getStocktakePreview(id, { signal }),
    enabled: !!id && enabled,
    refetchInterval: 5000,
    retry: 1,
  });
}
