import type {
  OpeningPalletCountDto,
  SkuDto,
} from "@/shared/api/generated/model";
export function OpeningCountSummary({
  pallet,
  skus,
}: {
  pallet: OpeningPalletCountDto;
  skus: SkuDto[];
}) {
  return (
    <div>
      <strong>
        {skus.find((s) => s.id === pallet.skuId)?.name ?? "Товар недоступен"}
      </strong>
      <p>
        {pallet.kind === "raw" ? "Нерасфасованный товар" : "Готовые короба"}
        {pallet.kind === "finished" ? ` · по ${pallet.unitsPerBox} шт.` : ""}
      </p>
      {pallet.batches.map((batch, index) => (
        <p key={`${batch.receivedAt}:${index}`}>
          {new Intl.DateTimeFormat("ru-RU", {
            timeZone: "Europe/Moscow",
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(new Date(batch.receivedAt))}{" "}
          · {batch.quantity.toLocaleString("ru-RU")}{" "}
          {pallet.kind === "raw" ? "шт." : "коробов"}
        </p>
      ))}
      {pallet.kind === "raw" && (
        <p>
          Полная высота: {(pallet.heightMm ?? 0) / 10} см
          {pallet.weightKg != null ? ` · масса: ${pallet.weightKg} кг` : ""}
        </p>
      )}
    </div>
  );
}
