import { ReceiptLabelsPage } from "@/pages/receipt-labels-page";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReceiptLabelsPage id={id} />;
}
