import assert from "node:assert/strict";
import { test } from "node:test";
import { locationSign } from "./location-sign";

test("physical place comes from the name for both two- and three-pallet racks", () => {
  for (const [code, title, place, tier] of [
    ["A-07-01", "Малый · левый стеллаж · место 1 · ярус 1", "1", "1"],
    ["A-09-04", "Малый · левый стеллаж · место 3 · ярус 4", "3", "4"],
    ["B-08-02", "Большой · оранжевый стеллаж 4 · место 2 · ярус 2", "2", "2"],
    ["B-11-03", "Большой · красный стеллаж · место 3 · ярус 3", "3", "3"],
    ["F-16", "Большой · напольный ряд · место 16", "16", null],
  ] as const) {
    const label = { code, title };
    assert.deepEqual(locationSign(label), { place, tier, archived: false });
    assert.equal(label.code, code);
    assert.equal(label.title, title);
  }
});

test("custom names retain the address without guessing a rack size or tier", () => {
  assert.deepEqual(
    locationSign({ code: "F-17", title: "Напольное место между группами" }),
    {
      place: "F-17",
      tier: null,
      archived: false,
    },
  );
  assert.deepEqual(
    locationSign({ code: "CUSTOM-123", title: "место для 3 паллет" }),
    {
      place: "CUSTOM-123",
      tier: null,
      archived: false,
    },
  );
});

test("archive marking survives the compact template", () => {
  assert.deepEqual(
    locationSign({
      code: "A-01-02",
      title: "Архив · Малый · место 1 · ярус 2",
    }),
    {
      place: "1",
      tier: "2",
      archived: true,
    },
  );
});
