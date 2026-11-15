"use client";
import { useState } from "react";
import { reportDefaults, type ReportFilterValues } from "./report-filter";

export function useReportState(
  isManager: boolean,
  ownEmployeeId: string,
  initialEmployeeId?: string,
) {
  const [filters, setFilters] = useState(() =>
    reportDefaults(isManager, ownEmployeeId, initialEmployeeId),
  );
  const [shiftPage, setShiftPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);

  function apply(values: ReportFilterValues) {
    setFilters(values);
    setShiftPage(1);
    setEventPage(1);
  }

  return { filters, shiftPage, eventPage, apply, setShiftPage, setEventPage };
}
