"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { GetTaskHistoryKind } from "../api/generated/model";
export type ScanTaskReference = { kind: GetTaskHistoryKind; id: string };
const Context = createContext<ScanTaskReference | undefined>(undefined);
export function EmployeeTaskScanLog({
  task,
  children,
}: {
  task?: ScanTaskReference;
  children: ReactNode;
}) {
  return <Context.Provider value={task}>{children}</Context.Provider>;
}
export const useEmployeeTaskScanLog = () => useContext(Context);
