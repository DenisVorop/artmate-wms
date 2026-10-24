import { notFound } from "next/navigation";
import { LabelPage } from "@/pages/label-page";
export default async function Page({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type, id } = await params;
  if (type !== "location" && type !== "pallet" && type !== "box") notFound();
  return <LabelPage type={type} id={id} />;
}
