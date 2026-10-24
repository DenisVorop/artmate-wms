import test from "node:test";
import assert from "node:assert/strict";
import type { StocktakeRowDto } from "@/shared/api/generated/model";
import {
  addCountBox,
  stocktakeCountSchema,
  toStocktakeCount,
  stocktakeCountDefaults,
  pendingCountBoxError,
} from "./count-form";
const form = {
  locationCode: "P-01",
  rawPallets: [{ palletCode: "RAW-01", quantity: "", present: true }],
  boxCodes: [],
  inspected: true,
};
test("blank raw quantity never silently becomes an empty pallet; explicit zero is valid", () => {
  assert.equal(stocktakeCountSchema.safeParse(form).success, false);
  assert.equal(
    stocktakeCountSchema.safeParse({
      ...form,
      rawPallets: [{ palletCode: "RAW-01", quantity: "0", present: true }],
    }).success,
    true,
  );
  for (const quantity of ["-1", "1.5", "Infinity", "100000001"]) {
    assert.equal(
      stocktakeCountSchema.safeParse({
        ...form,
        rawPallets: [{ palletCode: "RAW-01", quantity, present: true }],
      }).success,
      false,
    );
  }
});
test("empty location is saved only with explicit inspection, never from unchecked boxes alone", () => {
  assert.equal(
    stocktakeCountSchema.safeParse({
      ...form,
      rawPallets: [],
      inspected: false,
    }).success,
    false,
  );
  assert.deepEqual(stocktakeCountSchema.parse({ ...form, rawPallets: [] }), {
    ...form,
    rawPallets: [],
  });
});
test("code entry normalizes spaces, preserves actual codes, and rejects duplicate evidence", () => {
  const first = addCountBox([], " BOX-01 ");
  assert.deepEqual(first, { codes: ["BOX-01"], error: null });
  assert.notEqual(addCountBox(first.codes, "box-01").error, null);
  assert.equal(
    stocktakeCountSchema.safeParse({
      ...form,
      rawPallets: [],
      boxCodes: ["BOX-01", "box-01"],
    }).success,
    false,
  );
  assert.equal(
    stocktakeCountSchema.safeParse({
      ...form,
      rawPallets: [
        { palletCode: " RAW-01 ", quantity: "1", present: true },
        { palletCode: "raw-01", quantity: "2", present: true },
      ],
    }).success,
    false,
  );
});

test("absent source pallet is omitted while a positively found target retains its measured quantity", () => {
  const source = toStocktakeCount({
    ...form,
    rawPallets: [{ palletCode: "RAW-01", quantity: "", present: false }],
  });
  const target = toStocktakeCount({
    ...form,
    locationCode: "P-02",
    rawPallets: [{ palletCode: "RAW-01", quantity: "80", present: true }],
  });
  assert.deepEqual(source.rawPallets, []);
  assert.deepEqual(target.rawPallets, [{ palletCode: "RAW-01", quantity: 80 }]);
  assert.deepEqual(
    toStocktakeCount({
      ...form,
      rawPallets: [{ palletCode: "RAW-01", quantity: "0", present: true }],
    }).rawPallets,
    [{ palletCode: "RAW-01", quantity: 0 }],
  );
});

test("new count never copies expected stock into facts, while an explicitly saved count can be reopened", () => {
  const row: StocktakeRowDto = {
    locationId: "cell",
    locationCode: "P-01",
    locationName: "Место",
    baselineVersion: 1,
    currentVersion: 1,
    countVersion: null,
    stale: false,
    busyReasons: [],
    count: null,
    countedAt: null,
    countedByEmployeeId: null,
    countedByName: null,
    baseline: {
      pallet: null,
      rawPallets: [
        {
          palletId: "p",
          palletCode: "RAW-01",
          skuId: "sku",
          skuName: "Котики",
          lotId: "lot",
          lotName: "Партия",
          receivedAt: "2026-10-24T00:00:00Z",
          quantity: 1000,
        },
      ],
      boxes: [
        {
          id: "box",
          code: "BOX-01",
          skuId: "sku",
          skuName: "Котики",
          units: 20,
          palletId: "fg",
        },
      ],
    },
  };
  const fresh = stocktakeCountDefaults(row);
  assert.equal(fresh.locationCode, "");
  assert.equal(fresh.inspected, false);
  assert.deepEqual(fresh.boxCodes, []);
  assert.deepEqual(fresh.rawPallets, [
    { palletCode: "RAW-01", quantity: "", present: false },
  ]);
  const saved = stocktakeCountDefaults({
    ...row,
    count: {
      rawPallets: [{ palletCode: "RAW-01", quantity: 800 }],
      boxCodes: ["BOX-01"],
    },
  });
  assert.equal(saved.rawPallets[0]?.quantity, "800");
  assert.equal(saved.rawPallets[0]?.present, true);
  assert.deepEqual(saved.boxCodes, ["BOX-01"]);
  assert.equal(saved.inspected, false);
});

test("a typed but uncommitted box code blocks saving instead of silently losing the evidence", () => {
  assert.notEqual(pendingCountBoxError(" BOX-UNKNOWN "), null);
  assert.equal(pendingCountBoxError("   "), null);
  const added = addCountBox([], " BOX-UNKNOWN ");
  assert.deepEqual(added.codes, ["BOX-UNKNOWN"]);
});
