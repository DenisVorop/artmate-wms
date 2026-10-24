import type { ReceiptDto, WorkspaceDto } from "@/shared/api/generated/model";
export const receiptStatusLabels: Record<string, string> = {
  awaiting_placement: "Ожидает размещения",
  partially_placed: "Размещена частично",
  completed: "Завершена",
};
export function receiptProgress(receipt: ReceiptDto) {
  const placed = receipt.pallets.filter(
    (pallet) => pallet.placedAt !== null,
  ).length;
  return {
    placed,
    total: receipt.pallets.length,
    percent: receipt.pallets.length
      ? (placed / receipt.pallets.length) * 100
      : 0,
  };
}
export function filterReceipts(
  data: WorkspaceDto,
  view: "active" | "archive",
  search: string,
) {
  const query = search.toLowerCase().trim();
  return [...data.receipts]
    .filter(
      (receipt) =>
        (view === "archive"
          ? receipt.status === "completed"
          : receipt.status !== "completed") &&
        (!query ||
          [
            receipt.code,
            ...receipt.pallets.map(
              (row) =>
                data.skus.find((sku) => sku.id === row.skuId)?.name ?? "",
            ),
          ]
            .join(" ")
            .toLowerCase()
            .includes(query)),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export const receiptDate = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
