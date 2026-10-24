import assert from "node:assert/strict";
import { test } from "node:test";
import { boxPlacement } from "./box-placement";

test("Статусы различают накопление, ручное размещение и хранение без выдуманного адреса переносимого короба", () => {
  const data: Parameters<typeof boxPlacement>[0] = {
    locations: [
      { id: "assembly", code: "ASM", kind: "assembly" },
      { id: "storage", code: "A-1", kind: "floor" },
    ],
    pallets: [
      { id: "common", kind: "assembly", status: "stored" },
      { id: "finished", kind: "finished", status: "stored" },
    ],
  };
  assert.equal(
    boxPlacement(data, {
      status: "stored",
      locationId: "assembly",
      palletId: "common",
    }).status,
    "На накоплении",
  );
  assert.equal(
    boxPlacement(data, {
      status: "stored",
      locationId: "assembly",
      palletId: "finished",
    }).status,
    "На накоплении",
  );
  assert.deepEqual(
    boxPlacement(data, {
      status: "in_transit",
      locationId: null,
      palletId: null,
    }),
    { address: "У сотрудника", status: "В размещении", tone: "warning" },
  );
  assert.equal(
    boxPlacement(data, {
      status: "stored",
      locationId: "storage",
      palletId: "finished",
    }).status,
    "На хранении",
  );
  assert.equal(
    boxPlacement(data, {
      status: "shipped",
      locationId: "storage",
      palletId: "finished",
    }).status,
    "Отгружен",
  );
});
