import { matchesScan } from "./handling";

export interface FirstScanDecision {
  accepted: boolean;
  /** null leaves a server command error visible without replacing it. */
  error: string | null;
}

export function isPreprintedPalletScan(value: string): boolean {
  const code = value.trim().replace(/^artmate-wms:pallet:/, "");
  return /^PLT-PRE-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    code,
  );
}

/** Local identity checks never claim a free label. The server decides ownership. */
export async function receiptPalletScan(
  value: string,
  pallet: { id: string; code: string },
  bind: (value: string) => Promise<boolean>,
): Promise<FirstScanDecision> {
  if (matchesScan(value, "pallet", pallet.id, pallet.code))
    return { accepted: true, error: null };
  if (!isPreprintedPalletScan(value))
    return {
      accepted: false,
      error: "Сканируйте свободную этикетку паллеты или QR этой паллеты.",
    };
  return { accepted: await bind(value.trim()), error: null };
}
