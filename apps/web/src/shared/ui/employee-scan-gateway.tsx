"use client";
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createScanInterceptor,
  type ScanDisposition,
  type ScanInterception,
} from "../lib/scan-interceptor";

export type EmployeeScanDisposition = ScanDisposition;
export type EmployeeScanGatewayProps = {
  children: ReactNode;
  canIntercept?: (value: string) => boolean;
  intercept: (value: string) => ScanInterception;
};
const Context = createContext<{
  pending: boolean;
  intercept: (value: string) => ScanInterception;
}>({ pending: false, intercept: () => "pass" });

/** Generic preflight only. The provider owner decides which codes represent navigation/work. */
export function EmployeeScanGateway({
  children,
  intercept,
  canIntercept,
}: EmployeeScanGatewayProps) {
  const handler = useRef({ intercept, canIntercept });
  handler.current = { intercept, canIntercept };
  const [pending, setPending] = useState(false);
  const dispatch = useRef<ReturnType<typeof createScanInterceptor> | null>(
    null,
  );
  if (!dispatch.current)
    dispatch.current = createScanInterceptor({
      canIntercept: (value) => handler.current.canIntercept?.(value) ?? true,
      intercept: (value) => handler.current.intercept(value),
      changed: setPending,
    });
  const value = useMemo(
    () => ({ pending, intercept: dispatch.current! }),
    [pending],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useEmployeeScanGateway = () => useContext(Context);
