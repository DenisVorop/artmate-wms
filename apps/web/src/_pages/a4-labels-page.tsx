import { A4LabelsFeature } from "@/features/labels";
export function A4LabelsPage(props: {
  type?: "location" | "work-zone";
  id?: string;
}) {
  return (
    <main>
      <A4LabelsFeature {...props} />
    </main>
  );
}
