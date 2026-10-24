import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReceiptDto, WorkspaceDto } from "@/shared/api/generated/model";
import { filterReceipts, receiptProgress } from "./receipt-view";
const receipt: ReceiptDto = {
  id: "receipt",
  code: "RC-001",
  receivedAt: "2024-01-01T00:00:00.000Z",
  createdAt: "2024-01-02T00:00:00.000Z",
  completedAt: null,
  status: "partially_placed",
  pallets: [
    {
      palletId: "placed",
      skuId: "sku",
      quantity: 1000,
      locationId: "historic-location",
      placedAt: "2024-01-02T10:00:00.000Z",
      placedByEmployeeId: "employee",
    },
    {
      palletId: "awaiting",
      skuId: "sku",
      quantity: 500,
      locationId: null,
      placedAt: null,
      placedByEmployeeId: null,
    },
  ],
};
test("Прогресс приёмки опирается на неизменную историю документа, а не текущие остатки паллеты", () => {
  assert.deepEqual(receiptProgress(receipt), {
    placed: 1,
    total: 2,
    percent: 50,
  });
  const completed: ReceiptDto = {
    ...receipt,
    status: "completed",
    pallets: receipt.pallets.map((row) => ({
      ...row,
      placedAt: "2024-01-02T10:00:00Z",
    })),
  };
  assert.deepEqual(receiptProgress(completed), {
    placed: 2,
    total: 2,
    percent: 100,
  });
  assert.deepEqual(receiptProgress({ ...receipt, pallets: [] }), {
    placed: 0,
    total: 0,
    percent: 0,
  });
});
test("Active/archive и поиск не выдумывают документы для legacy паллет и не меняют исходный snapshot", () => {
  const completed = {
    ...receipt,
    id: "done",
    code: "RC-002",
    status: "completed" as const,
    createdAt: "2024-01-03T00:00:00.000Z",
  };
  // Only fields read by this projection: no fake histories for pallets elsewhere in workspace.
  const data = {
    receipts: [receipt, completed],
    skus: [{ id: "sku", name: "Котики-2" }],
    pallets: [{ id: "legacy-without-document" }],
  } as unknown as WorkspaceDto;
  assert.deepEqual(
    filterReceipts(data, "active", "").map((row) => row.id),
    ["receipt"],
  );
  assert.deepEqual(
    filterReceipts(data, "archive", " котики ").map((row) => row.id),
    ["done"],
  );
  assert.deepEqual(
    filterReceipts(data, "archive", "RC-002").map((row) => row.id),
    ["done"],
  );
  assert.equal(filterReceipts(data, "active", "RC-002").length, 0);
  assert.deepEqual(
    data.receipts.map((row) => row.id),
    ["receipt", "done"],
  );
});
