"use client";
import {
  useShiftHistory,
  useWorkforceReport,
  useWorkHistory,
} from "@/entities/workforce";
import { reportQuery, type ReportFilterValues } from "../lib/report-filter";

export function useReportResults(
  values: ReportFilterValues,
  isManager: boolean,
  ownEmployeeId: string,
) {
  return useWorkforceReport(
    reportQuery(values, isManager, ownEmployeeId),
    !!ownEmployeeId,
  );
}

export function useEmployeeHistory(
  values: ReportFilterValues,
  employeeId: string,
  shiftPage: number,
  eventPage: number,
) {
  const base = { from: values.from, to: values.to, employeeId, pageSize: 10 };
  const shifts = useShiftHistory({ ...base, page: shiftPage }, !!employeeId);
  const events = useWorkHistory({ ...base, page: eventPage }, !!employeeId);
  return { shifts, events };
}
