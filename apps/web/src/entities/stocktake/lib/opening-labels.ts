import type { StocktakeDto, LabelDto } from "@/shared/api/generated/model";
export const OPENING_LABEL_PAGE_SIZE = 100;
export type OpeningLabelRef = { type: "pallet" | "box"; id: string };
export function openingLabelPage(
  doc: StocktakeDto,
  locationId: string,
  page = 1,
) {
  if (doc.mode !== "opening" || doc.status !== "approved")
    throw new Error(
      "Этикетки доступны после утверждения первичной инвентаризации.",
    );
  const row = doc.rows.find((r) => r.locationId === locationId);
  if (!row?.openingResult)
    throw new Error(
      "У этого адреса нет сохранённых этикеток первичного ввода.",
    );
  const result = row.openingResult;
  if (
    !Array.isArray(result.boxIds) ||
    result.boxIds.length > 2000 ||
    result.boxIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(result.boxIds).size !== result.boxIds.length ||
    !(
      result.palletId === null ||
      (typeof result.palletId === "string" && !!result.palletId.trim())
    )
  )
    throw new Error("Некорректный сохранённый комплект этикеток.");
  const refs: OpeningLabelRef[] = [
    ...(result.palletId
      ? [{ type: "pallet" as const, id: result.palletId }]
      : []),
    ...result.boxIds.map((id) => ({ type: "box" as const, id })),
  ];
  const pages = Math.max(1, Math.ceil(refs.length / OPENING_LABEL_PAGE_SIZE));
  if (!Number.isInteger(page) || page < 1 || page > pages)
    throw new Error("Выберите существующую страницу этикеток.");
  return {
    refs: refs.slice(
      (page - 1) * OPENING_LABEL_PAGE_SIZE,
      page * OPENING_LABEL_PAGE_SIZE,
    ),
    total: refs.length,
    pages,
    page,
    locationCode: row.locationCode,
  };
}
export async function loadOpeningLabelPage(
  refs: OpeningLabelRef[],
  load: (ref: OpeningLabelRef) => Promise<LabelDto>,
  signal?: AbortSignal,
) {
  if (refs.length > OPENING_LABEL_PAGE_SIZE)
    throw new Error("Слишком много этикеток на одной странице.");
  const results: { ref: OpeningLabelRef; label: LabelDto }[] = new Array(
    refs.length,
  );
  let next = 0,
    failed = false;
  await Promise.all(
    Array.from({ length: Math.min(4, refs.length) }, async () => {
      while (!failed && next < refs.length) {
        signal?.throwIfAborted();
        const index = next++;
        try {
          const ref = refs[index];
          const label = await load(ref);
          signal?.throwIfAborted();
          // The stocktake stores the box ID; its physical QR contains the box code.
          if (
            ![label.svg, label.payload, label.code, label.title].every(
              (value) => typeof value === "string" && !!value.trim(),
            ) ||
            (ref.type === "box" && label.boxId !== ref.id) ||
            label.payload !==
              `artmate-wms:${ref.type}:${ref.type === "box" ? label.code : ref.id}`
          )
            throw new Error("Не удалось получить полный QR этикетки.");
          results[index] = { ref, label };
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    }),
  );
  return results;
}
