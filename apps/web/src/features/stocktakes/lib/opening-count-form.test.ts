import test from "node:test";
import assert from "node:assert/strict";
import {
  openingCountDefaults,
  openingCountSchema,
  openingToday,
  toOpeningCount,
} from "./opening-count-form";
const today = "2026-10-27";
const raw = () => ({
  ...openingCountDefaults({ count: null }),
  locationCode: "A-01",
  observed: "pallet" as const,
  skuId: "cats",
  batches: [{ receivedOn: "2026-10-15", quantity: "1000" }],
  heightCm: "71.2",
  inspected: true,
});
test("opening never guesses an empty address, receipt date, quantity or physical inspection from WMS", () => {
  const blank = openingCountDefaults({ count: null });
  assert.equal(blank.observed, "");
  assert.equal(blank.batches[0].receivedOn, "");
  assert.equal(blank.batches[0].quantity, "");
  assert.equal(blank.inspected, false);
  assert.equal(openingCountSchema(today).safeParse(blank).success, false);
  assert.equal(
    openingCountDefaults({ count: { rawPallets: [], boxCodes: [] } }).observed,
    "",
  );
  const empty = toOpeningCount(
    { ...blank, locationCode: "A-01", observed: "empty", inspected: true },
    today,
  );
  assert.deepEqual(empty, {
    locationCode: "A-01",
    rawPallets: [],
    boxCodes: [],
    openingPallet: null,
  });
});
test("raw pallet quantities stay units and full centimetre height becomes millimetres; Moscow receipt day is retained", () => {
  const command = toOpeningCount(raw(), today);
  assert.deepEqual(command.openingPallet, {
    kind: "raw",
    skuId: "cats",
    batches: [{ receivedAt: "2026-10-14T21:00:00.000Z", quantity: 1000 }],
    heightMm: 712,
    weightKg: null,
  });
  assert.equal(openingToday(new Date("2026-10-26T21:00:00Z")), today);
  for (const patch of [
    { batches: [{ receivedOn: "", quantity: "1000" }] },
    { batches: [{ receivedOn: "2026-10-28", quantity: "1000" }] },
    { batches: [{ receivedOn: "2026-02-30", quantity: "1000" }] },
    { batches: [{ receivedOn: "2026-10-15", quantity: "0" }] },
    { heightCm: "" },
    { heightCm: "14" },
    { inspected: false },
    { locationCode: "" },
  ])
    assert.equal(
      openingCountSchema(today).safeParse({ ...raw(), ...patch }).success,
      false,
    );
  assert.equal(
    openingCountSchema(today).safeParse({
      ...raw(),
      batches: [...raw().batches, ...raw().batches],
    }).success,
    false,
  );
});
test("finished counts remain boxes on their actual receipt dates with explicit packing, never fabricated box IDs", () => {
  const values = {
    ...raw(),
    kind: "finished" as const,
    unitsPerBox: "20",
    batches: [
      { receivedOn: "2026-10-10", quantity: "3" },
      { receivedOn: "2026-10-15", quantity: "4" },
    ],
  };
  const saved = toOpeningCount(values, today);
  assert.deepEqual(saved.boxCodes, []);
  assert.deepEqual(saved.rawPallets, []);
  assert.equal(
    saved.openingPallet?.batches.reduce((n, b) => n + b.quantity, 0),
    7,
  );
  assert.equal(saved.openingPallet?.unitsPerBox, 20);
  assert.equal(saved.openingPallet?.heightMm, undefined);
  assert.equal(
    openingCountSchema(today).safeParse({ ...values, unitsPerBox: "" }).success,
    false,
  );
  assert.equal(
    openingCountSchema(today).safeParse({
      ...values,
      batches: [
        { receivedOn: "2026-10-10", quantity: "2000" },
        { receivedOn: "2026-10-15", quantity: "1" },
      ],
    }).success,
    false,
  );
});
