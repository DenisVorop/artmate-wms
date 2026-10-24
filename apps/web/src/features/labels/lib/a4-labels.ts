import type { LabelDto, WorkspaceDto } from "@/shared/api/generated/model";

export type A4LabelType = "work-zone" | "location";
export type A4LabelItem = {
  key: string;
  type: A4LabelType;
  id: string;
  code: string;
  title: string;
  category: string;
};
const purposes = {
  receiving: "Приёмка",
  assembly: "Сборка",
  putaway: "Размещение",
  shipping: "Отгрузка",
};
export function a4LabelItems(data: WorkspaceDto): A4LabelItem[] {
  const sections = new Set(
    data.sections.filter((s) => !s.archived).map((s) => s.id),
  );
  return [
    ...data.warehouse.workZones
      .filter((z) => !z.archived)
      .map((z) => ({
        key: `work-zone:${z.id}`,
        type: "work-zone" as const,
        id: z.id,
        code: z.code,
        title: `${purposes[z.kind]} · ${z.name}`,
        category: "Рабочая зона",
      })),
    ...data.locations
      .filter((l) => !l.archived && (!l.sectionId || sections.has(l.sectionId)))
      .map((l) => ({
        key: `location:${l.id}`,
        type: "location" as const,
        id: l.id,
        code: l.code,
        title: l.name,
        category: l.sectionId ? `Место · ярус ${l.level}` : "Место",
      })),
  ].sort(
    (a, b) =>
      a.type.localeCompare(b.type) ||
      a.code.localeCompare(b.code, "ru", { numeric: true }),
  );
}
export function a4Sheets<T>(items: T[]): T[][] {
  return Array.from({ length: Math.ceil(items.length / 4) }, (_, i) =>
    items.slice(i * 4, i * 4 + 4),
  );
}
/** Read a complete batch with bounded concurrency; partial batches never reach print. */
export async function readA4Labels(
  items: A4LabelItem[],
  read: (
    type: A4LabelType,
    id: string,
    signal: AbortSignal,
  ) => Promise<LabelDto>,
  signal: AbortSignal,
): Promise<(A4LabelItem & { label: LabelDto })[]> {
  const result: (A4LabelItem & { label: LabelDto })[] = new Array(items.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < items.length) {
      signal.throwIfAborted();
      const index = next++;
      const item = items[index];
      try {
        const label = await read(item.type, item.id, signal);
        signal.throwIfAborted();
        if (
          label.payload !== `artmate-wms:${item.type}:${item.id}` ||
          label.code !== item.code ||
          label.title !== item.title ||
          !label.svg
        )
          throw new Error(
            "Данные таблички изменились. Обновите список и повторите загрузку.",
          );
        result[index] = { ...item, label };
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  return result;
}
