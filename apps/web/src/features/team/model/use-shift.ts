"use client";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import { toCreateEmployee, type EmployeeValues } from "../lib/employee-form";
export function useShift() {
  const c = useWarehouseCommands();
  return {
    ...c,
    create: (values: EmployeeValues) =>
      c.createEmployee(toCreateEmployee(values)),
    setShift: (id: string, status: "working" | "break" | "off") =>
      c.updateEmployeeShift(id, { requestId: crypto.randomUUID(), status }),
  };
}
