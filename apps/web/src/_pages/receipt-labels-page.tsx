import { ReceiptLabelsFeature } from "@/features/receipt-labels";

export function ReceiptLabelsPage({ id }: { id: string }) {
  return (
    <main>
      <ReceiptLabelsFeature id={id} />
    </main>
  );
}
