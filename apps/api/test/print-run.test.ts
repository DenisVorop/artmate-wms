import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceDto } from "../src/dto";
import { samePrintRun } from "../src/print-run";

function fixture() {
  return {
    lots: ["a", "b", "c"].map((id) => ({
      id,
      skuId: "cats",
      name: "Same",
      receivedAt: "2026-11-16T14:32:00.000Z",
    })),
    pallets: ["a", "b", "c"].map((id) => ({
      id: `p-${id}`,
      kind: "raw",
      skuId: "cats",
      lotId: id,
      status: id === "a" ? "retired" : "stored",
      quantity: id === "a" ? 0 : 20,
    })),
    receipts: [
      {
        id: "first",
        pallets: ["a", "b"].map((id) => ({
          palletId: `p-${id}`,
          skuId: "cats",
        })),
      },
      { id: "second", pallets: [{ palletId: "p-c", skuId: "cats" }] },
    ],
  } as unknown as Pick<WorkspaceDto, "lots" | "pallets" | "receipts">;
}

test("legacy lots from two raw pallets of the same receipt are one print run without rewriting history", () => {
  const state = fixture(),
    before = JSON.stringify(state);
  assert.equal(samePrintRun(state, "a", "b"), true);
  assert.equal(samePrintRun(state, "b", "a"), true);
  assert.equal(samePrintRun(state, "a", "a"), true);
  assert.equal(JSON.stringify(state), before);
});

test("equal dates and names never merge different receipts or unlinked opening lots", () => {
  const state = fixture();
  assert.equal(samePrintRun(state, "a", "c"), false);
  state.receipts = [];
  assert.equal(samePrintRun(state, "a", "b"), false);
  assert.equal(samePrintRun(state, "a", "a"), true);
  assert.equal(samePrintRun(state, undefined, undefined), false);
  assert.equal(samePrintRun(state, "missing", "missing"), false);
});

test("different SKUs, mismatched receipt rows and ambiguous receipt provenance remain separate", () => {
  const state = fixture();
  state.lots[1].skuId = "dogs";
  assert.equal(samePrintRun(state, "a", "b"), false);
  state.lots[1].skuId = "cats";
  state.receipts[0].pallets[1].skuId = "dogs";
  assert.equal(samePrintRun(state, "a", "b"), false);
  state.receipts[0].pallets[1].skuId = "cats";
  state.receipts[1].pallets.push(state.receipts[0].pallets[1]);
  assert.equal(samePrintRun(state, "a", "b"), false);
});
