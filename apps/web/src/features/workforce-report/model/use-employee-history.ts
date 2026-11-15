"use client";
import { useShiftHistory, useWorkHistory } from "@/entities/workforce";
import type { GetPerformanceParams } from "@/shared/api/generated/model";

export function useEmployeeHistory(
  params: GetPerformanceParams,
  shiftPage: number,
  eventPage: number,
) {
  const base = { ...params, pageSize: 10 };
  const shifts = useShiftHistory({ ...base, page: shiftPage });
  const events = useWorkHistory({ ...base, page: eventPage });
  return { shifts, events };
}
