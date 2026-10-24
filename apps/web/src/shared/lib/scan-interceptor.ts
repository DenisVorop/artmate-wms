export type ScanDisposition = "pass" | "handled" | "blocked";
export type ScanInterception = ScanDisposition | Promise<ScanDisposition>;
export function createScanInterceptor(port: {
  canIntercept: (value: string) => boolean;
  intercept: (value: string) => ScanInterception;
  changed: (pending: boolean) => void;
}) {
  let pending = false;
  return (value: string): ScanInterception => {
    if (pending) return "blocked";
    if (!port.canIntercept(value)) return "pass";
    const result = port.intercept(value);
    if (typeof result === "string") return result;
    pending = true;
    port.changed(true);
    return Promise.resolve(result).finally(() => {
      pending = false;
      port.changed(false);
    });
  };
}
