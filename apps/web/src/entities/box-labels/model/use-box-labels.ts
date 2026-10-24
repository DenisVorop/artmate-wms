"use client";
import { useQuery } from "@tanstack/react-query";
import {
  getBoxLabelBatches,
  getBoxLabelBatchLabels,
} from "@/shared/api/generated/client";
export function useBoxLabelBatches(scope: string, page: number) {
  return useQuery({
    queryKey: ["box-label-batches", scope, page],
    queryFn: ({ signal }) =>
      getBoxLabelBatches({ page, pageSize: 10 }, { signal }),
    retry: false,
  });
}
export function useFreeBoxLabels(
  scope: string,
  id: string | null,
  page: number,
  pageSize: number,
) {
  return useQuery({
    queryKey: ["box-label-page", scope, id, page, pageSize],
    enabled: !!id,
    queryFn: ({ signal }) =>
      getBoxLabelBatchLabels(
        id!,
        { page, pageSize, status: "free" },
        { signal },
      ),
    retry: false,
  });
}
