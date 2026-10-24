import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isAccountedPallet,
  isVisibleInventoryPallet,
  skuInventory,
} from "./inventory-balance";

test("Ожидающая приёмка не попадает в остатки, а уже учтённый товар в перемещении остаётся на балансе", () => {
  const data: Parameters<typeof skuInventory>[0] = {
    pallets: [
      {
        id: "stored",
        skuId: "sku",
        kind: "raw",
        status: "stored",
        quantity: 100,
      },
      {
        id: "transit",
        skuId: "sku",
        kind: "raw",
        status: "in_transit",
        quantity: 200,
      },
      {
        id: "pending",
        skuId: "sku",
        kind: "raw",
        status: "awaiting_placement",
        quantity: 1000,
      },
      {
        id: "retired",
        skuId: "sku",
        kind: "raw",
        status: "retired",
        quantity: 0,
      },
    ],
    boxes: [
      { skuId: "sku", status: "stored", units: 20 },
      { skuId: "sku", status: "shipped", units: 20 },
    ],
    tasks: [
      {
        skuId: "sku",
        scannedUnits: 5,
        reservations: [
          { palletId: "stored", lotId: "lot", quantity: 20 },
          { palletId: "pending", lotId: "pending-lot", quantity: 500 },
        ],
      },
    ],
  };
  assert.deepEqual(skuInventory(data, "sku"), {
    rawUnits: 300,
    workInProgressUnits: 5,
    boxedUnits: 20,
    totalUnits: 325,
    boxesCount: 1,
    reservedUnits: 20,
  });
  assert.equal(isAccountedPallet(data.pallets[1]), true);
  assert.equal(isVisibleInventoryPallet(data.pallets[2]), false);
  assert.equal(isVisibleInventoryPallet(data.pallets[3]), true);
});
