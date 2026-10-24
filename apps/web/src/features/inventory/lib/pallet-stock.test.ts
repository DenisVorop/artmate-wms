import assert from "node:assert/strict";
import { test } from "node:test";
import { palletComposition, palletMatchesSkus } from "./pallet-stock";
import { skuInventory } from "./inventory-balance";

test("Общая паллета показывает обе реальные тематики и находится фильтром каждой; переносимый короб остаётся на балансе темы", () => {
  const data = {
    skus: [
      { id: "cats", name: "Котики" },
      { id: "dogs", name: "Собачки" },
    ],
    boxes: [
      {
        palletId: "common",
        skuId: "cats",
        status: "stored" as const,
        units: 20,
      },
      {
        palletId: "common",
        skuId: "dogs",
        status: "stored" as const,
        units: 20,
      },
      {
        palletId: null,
        skuId: "cats",
        status: "in_transit" as const,
        units: 20,
      },
      {
        palletId: "common",
        skuId: "dogs",
        status: "shipped" as const,
        units: 20,
      },
    ],
    pallets: [],
    tasks: [],
  };
  const pallet = { id: "common", kind: "assembly" as const, skuId: null };
  assert.deepEqual(palletComposition(data, pallet.id), [
    { skuId: "cats", name: "Котики", boxes: 1, units: 20 },
    { skuId: "dogs", name: "Собачки", boxes: 1, units: 20 },
  ]);
  for (const id of ["cats", "dogs"])
    assert.equal(palletMatchesSkus(data, pallet, new Set([id]), false), true);
  assert.equal(
    palletMatchesSkus(data, pallet, new Set(["other"]), false),
    false,
  );
  assert.equal(skuInventory(data, "cats").boxedUnits, 40);
  assert.equal(skuInventory(data, "dogs").boxedUnits, 20);
  const empty = { ...pallet, id: "empty" };
  assert.equal(palletMatchesSkus(data, empty, new Set(), true), true);
  assert.equal(palletMatchesSkus(data, empty, new Set(["cats"]), false), false);
});
