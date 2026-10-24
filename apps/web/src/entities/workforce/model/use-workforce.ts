"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getPerformance,
  getShiftHistory,
  getWorkHistory,
} from "@/shared/api/generated/client";
import type {
  GetPerformanceParams,
  GetShiftHistoryParams,
  GetWorkHistoryParams,
} from "@/shared/api/generated/model";
import { workforceQueryKey } from "@/shared/api/query-keys";

export function useWorkforceReport(
  params: GetPerformanceParams,
  enabled = true,
) {
  return useQuery({
    queryKey: [...workforceQueryKey, "report", params],
    queryFn: ({ signal }) => getPerformance(params, { signal }),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
    retry: 1,
  });
}

export function useShiftHistory(params: GetShiftHistoryParams, enabled = true) {
  return useQuery({
    queryKey: [...workforceQueryKey, "shifts", params],
    queryFn: ({ signal }) => getShiftHistory(params, { signal }),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
    retry: 1,
  });
}

export function useWorkHistory(params: GetWorkHistoryParams, enabled = true) {
  return useQuery({
    queryKey: [...workforceQueryKey, "events", params],
    queryFn: ({ signal }) => getWorkHistory(params, { signal }),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
    retry: 1,
  });
}
