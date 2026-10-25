import test from "node:test";
import assert from "node:assert/strict";
import type { MarketplacePlanRowDto } from "@/entities/assembly-plan";
import { boxesLabel, planningGroups, planningRows } from "./planning-view";
const row = (
  name: string,
  state: MarketplacePlanRowDto["advice"]["state"],
  boxes: number,
  complete = true,
) =>
  ({
    skuName: name,
    dataComplete: complete,
    recommendedBoxes: boxes,
    advice: { state },
  }) as MarketplacePlanRowDto;
test("summary and assembly list never present unknown quantities as confirmed work", () => {
  const rows = [
    row("Зима", "raw_shortage", 2),
    row("Котики", "covered", 0),
    row("Нет остатков", "review", 99, false),
    row("Можно собирать", "ready", 3),
  ];
  const summary = planningGroups(rows);
  assert.equal(summary.boxes, 5);
  assert.equal(summary.assembly.length, 2);
  assert.equal(summary.review.length, 1);
  assert.equal(summary.covered.length, 1);
  assert.deepEqual(
    planningRows(rows, "assembly").map((r) => r.skuName),
    ["Можно собирать", "Зима"],
  );
  assert.deepEqual(
    planningRows(rows, "review").map((r) => r.skuName),
    ["Нет остатков"],
  );
  assert.equal(planningRows(rows, "all").length, 4);
  assert.equal(
    rows[0].skuName,
    "Зима",
    "filtering must not reorder cached data",
  );
});
test("Russian box counts remain readable at one, two, teen and twenty-one", () => {
  for (const [count, label] of [
    [0, "0 коробов"],
    [1, "1 короб"],
    [2, "2 короба"],
    [11, "11 коробов"],
    [21, "21 короб"],
    [112, "112 коробов"],
  ] as const)
    assert.equal(boxesLabel(count), label);
});
