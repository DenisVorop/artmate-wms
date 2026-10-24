import test from "node:test";
import assert from "node:assert/strict";
import {
  employeeStocktakeJobs,
  employeeStocktakeNextRow,
  employeeStocktakeCanLeave,
  employeeStocktakeSelection,
} from "./employee-stocktakes";
import { stocktakeCountDefaults, toStocktakeCount } from "./count-form";
import type {
  StocktakeSummaryDto,
  StocktakeRowDto,
} from "@/shared/api/generated/model";
const job = (
  id: string,
  status: StocktakeSummaryDto["status"],
  employeeId: string | null,
): StocktakeSummaryDto => ({
  id,
  code: id,
  status,
  employeeId,
  employeeName: employeeId,
  revision: 1,
  createdAt: "2026-10-24T00:00:00Z",
  createdByEmployeeId: "manager",
  createdByName: "Руководитель",
  approvedAt: null,
  cancelledAt: null,
  reason: null,
  locationsTotal: 2,
  locationsCounted: 0,
  staleLocations: 0,
});
const row = (
  id: string,
  patch: Partial<StocktakeRowDto> = {},
): StocktakeRowDto => ({
  locationId: id,
  locationCode: id,
  locationName: id,
  baselineVersion: 1,
  currentVersion: 1,
  countVersion: null,
  baseline: { pallet: null, rawPallets: [], boxes: [] },
  count: null,
  countedAt: null,
  countedByEmployeeId: null,
  countedByName: null,
  stale: false,
  busyReasons: [],
  ...patch,
});
const counted = { rawPallets: [], boxCodes: [] };
test("employee document cards prioritize own work, review then free queue, excluding foreign and archived documents", () => {
  const input = [
    job("queue", "queued", null),
    job("foreign", "counting", "other"),
    job("review", "review", "me"),
    job("done", "approved", "me"),
    job("working", "counting", "me"),
    job("cancelled", "cancelled", "me"),
  ];
  assert.deepEqual(
    employeeStocktakeJobs(input, "me").map((j) => j.id),
    ["working", "review", "queue"],
  );
  assert.equal(input[0].id, "queue");
});
test("one-cell progression skips saved cells, loops to stale cells and returns completion only after all rows fresh", () => {
  let rows = [row("a", { count: counted }), row("b"), row("c")];
  assert.equal(employeeStocktakeNextRow({ rows }), "b");
  rows[1] = { ...rows[1], count: counted };
  assert.equal(employeeStocktakeNextRow({ rows }, "b"), "c");
  rows[2] = { ...rows[2], count: counted };
  assert.equal(employeeStocktakeNextRow({ rows }, "c"), "");
  rows[0] = { ...rows[0], stale: true };
  assert.equal(employeeStocktakeNextRow({ rows }, "c"), "a");
});
test("busy cells stay visible for recovery but available cells are selected first; dirty navigation requires explicit discard", () => {
  const rows = [row("busy", { busyReasons: ["Перемещение"] }), row("free")];
  assert.equal(employeeStocktakeNextRow({ rows }), "free");
  assert.equal(
    employeeStocktakeNextRow({
      rows: [{ ...rows[1], count: counted }, rows[0]],
    }),
    "busy",
  );
  assert.equal(employeeStocktakeCanLeave(new Set()), true);
  assert.equal(employeeStocktakeCanLeave(new Set(["busy"])), false);
});
test("compact new count never prefills actual address pallet or box codes; manager defaults and saved evidence remain intact", () => {
  const source = row("A", {
    baseline: {
      pallet: null,
      rawPallets: [
        {
          palletId: "p",
          palletCode: "RAW-EXPECTED",
          skuId: "s",
          skuName: "Тема",
          lotId: "l",
          lotName: "Партия",
          receivedAt: "2026-10-24",
          quantity: 100,
        },
      ],
      boxes: [
        {
          id: "b",
          code: "BOX-EXPECTED",
          skuId: "s",
          skuName: "Тема",
          units: 20,
          palletId: "fg",
        },
      ],
    },
  });
  const fresh = stocktakeCountDefaults(source, true);
  assert.equal(fresh.locationCode, "");
  assert.deepEqual(fresh.rawPallets, []);
  assert.deepEqual(fresh.boxCodes, []);
  assert.equal(fresh.inspected, false);
  assert.equal(
    stocktakeCountDefaults(source).rawPallets[0].palletCode,
    "RAW-EXPECTED",
  );
  const saved = stocktakeCountDefaults(
    {
      ...source,
      count: {
        rawPallets: [{ palletCode: "RAW-SCANNED", quantity: 0 }],
        boxCodes: ["BOX-SCANNED"],
      },
    },
    true,
  );
  assert.deepEqual(saved.rawPallets, [
    { palletCode: "RAW-SCANNED", quantity: "0", present: true },
  ]);
  assert.deepEqual(saved.boxCodes, ["BOX-SCANNED"]);
  assert.deepEqual(
    toStocktakeCount({
      ...saved,
      locationCode: "SCANNED-ADDRESS",
      inspected: true,
    }).rawPallets,
    [{ palletCode: "RAW-SCANNED", quantity: 0 }],
  );
  assert.deepEqual(
    toStocktakeCount({
      ...saved,
      locationCode: "SCANNED-ADDRESS",
      inspected: true,
      rawPallets: [{ ...saved.rawPallets[0], present: false }],
    }).rawPallets,
    [],
  );
});

test("polling cannot move a mounted dirty cell form, and explicit completion stays distinct from initial selection", () => {
  const doc = { rows: [row("a"), row("b")] };
  assert.equal(employeeStocktakeSelection(doc, null), "a");
  doc.rows[0] = { ...doc.rows[0], count: counted };
  assert.equal(employeeStocktakeSelection(doc, "a"), "a");
  assert.equal(employeeStocktakeSelection(doc, ""), "");
  assert.equal(employeeStocktakeSelection(doc, null), "b");
});
