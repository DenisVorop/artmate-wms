import type { WorkspaceDto } from "./dto";

/** One SKU in one receipt is one print run, including legacy per-pallet lots.
 * Keep original lot IDs for FIFO, box contents and the immutable stock ledger.
 * Matching dates or display names alone never establish this identity. */
export function samePrintRun(
  state: Pick<WorkspaceDto, "lots" | "pallets" | "receipts">,
  leftLotId: string | undefined,
  rightLotId: string | undefined,
): boolean {
  const left = state.lots.find((lot) => lot.id === leftLotId);
  const right = state.lots.find((lot) => lot.id === rightLotId);
  if (!left || !right || left.skuId !== right.skuId) return false;
  if (left.id === right.id) return true;
  const receiptsFor = (lotId: string) => {
    const palletIds = new Set(
      state.pallets
        .filter(
          (pallet) =>
            pallet.kind === "raw" &&
            pallet.lotId === lotId &&
            pallet.skuId === left.skuId,
        )
        .map((pallet) => pallet.id),
    );
    return new Set(
      (state.receipts ?? [])
        .filter((receipt) =>
          receipt.pallets.some(
            (row) => row.skuId === left.skuId && palletIds.has(row.palletId),
          ),
        )
        .map((receipt) => receipt.id),
    );
  };
  const leftReceipts = receiptsFor(left.id);
  const rightReceipts = receiptsFor(right.id);
  return (
    leftReceipts.size === 1 &&
    rightReceipts.size === 1 &&
    [...leftReceipts][0] === [...rightReceipts][0]
  );
}
