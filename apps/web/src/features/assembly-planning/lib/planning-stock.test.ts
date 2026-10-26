import test from "node:test";
import assert from "node:assert/strict";
import {
  stockConfirmationSchema,
  stockConfirmationEntry,
} from "./planning-form";

test("stock confirmation uses total finished units and never adds a pallet or lot", () => {
  const values = stockConfirmationSchema.parse({ units: 160 });
  assert.deepEqual(stockConfirmationEntry("flowers", values), {
    skuId: "flowers",
    enabled: true,
    units: 160,
    accuracy: "exact",
    note: "Пересчёт готового товара руководителем",
  });
  assert.equal(stockConfirmationSchema.safeParse({ units: 0 }).success, true);
  for (const units of [-1, 0.5, Number.NaN, Infinity, 100000001])
    assert.equal(stockConfirmationSchema.safeParse({ units }).success, false);
});
