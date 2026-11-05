"use client";
import { useQuery } from "@tanstack/react-query";
import {
  getPalletLabelBatches,
  getPalletLabelBatchLabels,
} from "@/shared/api/generated/client";
export function usePalletLabelBatches(scope: string, page: number) {
  return useQuery({
    queryKey: ["pallet-label-batches", scope, page],
    queryFn: ({ signal }) =>
      getPalletLabelBatches({ page, pageSize: 10 }, { signal }),
    retry: false,
  });
}
export function useFreePalletLabels(
  scope: string,
  id: string | null,
  page: number,
  pageSize: number,
) {
  return useQuery({
    queryKey: ["pallet-label-page", scope, id, page, pageSize],
    enabled: !!id,
    queryFn: ({ signal }) =>
      getPalletLabelBatchLabels(
        id!,
        { page, pageSize, status: "free" },
        { signal },
      ),
    retry: false,
  });
}
