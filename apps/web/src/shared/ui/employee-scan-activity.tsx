"use client";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
const Context = createContext<{
  pending: number;
  report: (id: string, count: number) => void;
  unsaved: boolean;
  reportUnsaved: (id: string, active: boolean) => void;
}>({ pending: 0, report: () => {}, unsaved: false, reportUnsaved: () => {} });
export function EmployeeScanBoundary({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const report = useCallback(
    (id: string, count: number) =>
      setCounts((current) => {
        if ((current[id] ?? 0) === count) return current;
        const next = { ...current };
        if (count) next[id] = count;
        else delete next[id];
        return next;
      }),
    [],
  );
  const [unsavedWork, setUnsavedWork] = useState<Record<string, boolean>>({});
  const reportUnsaved = useCallback((id: string, active: boolean) => {
    setUnsavedWork((current) => {
      if (!!current[id] === active) return current;
      const next = { ...current };
      if (active) next[id] = true;
      else delete next[id];
      return next;
    });
  }, []);
  const unsaved = Object.values(unsavedWork).some(Boolean);
  const pending = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const value = useMemo(
    () => ({ pending, report, unsaved, reportUnsaved }),
    [pending, report, unsaved, reportUnsaved],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useEmployeeScanActivity = () => useContext(Context);
