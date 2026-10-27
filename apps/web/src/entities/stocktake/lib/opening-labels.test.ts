import test from "node:test";
import assert from "node:assert/strict";
import type { StocktakeDto, LabelDto } from "@/shared/api/generated/model";
import { openingLabelPage, loadOpeningLabelPage } from "./opening-labels";
const doc = () =>
  ({
    mode: "opening",
    status: "approved",
    rows: [
      {
        locationId: "A",
        locationCode: "A-1",
        openingResult: {
          palletId: "pallet",
          boxIds: Array.from({ length: 105 }, (_, i) => `box-${i}`),
        },
      },
    ],
  }) as unknown as StocktakeDto;
test("opening printing uses only approved saved identifiers and bounds an explicit page", () => {
  const first = openingLabelPage(doc(), "A", 1),
    second = openingLabelPage(doc(), "A", 2);
  assert.equal(first.refs.length, 100);
  assert.equal(first.total, 106);
  assert.equal(first.pages, 2);
  assert.deepEqual(first.refs[0], { type: "pallet", id: "pallet" });
  assert.equal(second.refs.length, 6);
  for (const changed of [
    { ...doc(), status: "review" as const },
    { ...doc(), mode: "recount" as const },
  ])
    assert.throws(() => openingLabelPage(changed, "A"), /после утверждения/);
  assert.throws(() => openingLabelPage(doc(), "another"), /нет сохранённых/);
  assert.throws(() => openingLabelPage(doc(), "A", 3), /существующую страницу/);
  const duplicate = doc();
  duplicate.rows[0].openingResult!.boxIds = ["one", "one"];
  assert.throws(() => openingLabelPage(duplicate, "A"), /Некорректный/);
});
test("label loading retains order, has at most four requests in flight, and returns no successful partial kit", async () => {
  const refs = openingLabelPage(doc(), "A").refs.slice(0, 12);
  let active = 0,
    max = 0;
  const load = async (ref: (typeof refs)[number]): Promise<LabelDto> => {
    active++;
    max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return {
      code: ref.id,
      title: "Котики",
      payload: `artmate-wms:${ref.type}:${ref.id}`,
      svg: "<svg/>",
    };
  };
  const loaded = await loadOpeningLabelPage(refs, load);
  assert.equal(max, 4);
  assert.deepEqual(
    loaded.map((item) => item.ref),
    refs,
  );
  let calls = 0;
  await assert.rejects(
    loadOpeningLabelPage(refs, async (ref) => {
      calls++;
      if (ref.id === "pallet") throw new Error("network");
      return load(ref);
    }),
    /network/,
  );
  assert.ok(calls <= 4);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(loadOpeningLabelPage(refs, load, cancelled.signal));
});

test("label loading rejects mismatched QR identifiers and malformed label content", async () => {
  const refs = [{ type: "pallet" as const, id: "expected" }];
  const label = {
    code: "P1",
    title: "Паллета",
    svg: "<svg/>",
    payload: "artmate-wms:pallet:expected",
  };
  await assert.rejects(
    loadOpeningLabelPage(refs, async () => ({
      ...label,
      payload: "artmate-wms:pallet:other",
    })),
    /полный QR/,
  );
  await assert.rejects(
    loadOpeningLabelPage(refs, async () => ({ ...label, title: " " })),
    /полный QR/,
  );
});
