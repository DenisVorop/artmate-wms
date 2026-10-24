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
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(
    initialEmployeeId && isManager ? initialEmployeeId : ownEmployeeId,
  );
  const [shiftPage, setShiftPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);
  const apply = (values: ReportFilterValues) => {
    setFilters(values);
    setSelectedEmployeeId(
      isManager ? values.employeeId || selectedEmployeeId : ownEmployeeId,
    );
    setShiftPage(1);
    setEventPage(1);
  };
  const selectEmployee = (id: string) => {
    setSelectedEmployeeId(id);
    setShiftPage(1);
    setEventPage(1);
  };
  return {
    filters,
    selectedEmployeeId,
    shiftPage,
    eventPage,
    apply,
    selectEmployee,
    setShiftPage,
    setEventPage,
  };
}
