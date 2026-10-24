import { LabelFeature } from "@/features/labels";
export function LabelPage({
  type,
  id,
}: {
  type: "location" | "pallet" | "box" | "work-zone";
  id: string;
}) {
  return (
    <main>
      <LabelFeature type={type} id={id} />
    </main>
  );
}
