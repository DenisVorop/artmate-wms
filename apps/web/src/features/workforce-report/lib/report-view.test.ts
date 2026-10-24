import assert from "node:assert/strict";
import test from "node:test";
import {
  formatWorkforceDuration,
  workforceDateTime,
  workforcePages,
  workEventTitle,
  workforceCoverage,
  workforceTotals,
  hasWorkforceFacts,
} from "./report-view";
import type { EmployeePerformanceDto } from "@/shared/api/generated/model";

test("durations do not round a partial minute into completed work or wrap after 24h", () => {
  assert.equal(formatWorkforceDuration(0), "0 мин");
  assert.equal(formatWorkforceDuration(59), "<1 мин");
  assert.equal(formatWorkforceDuration(60), "1 мин");
  assert.equal(formatWorkforceDuration(3599), "59 мин");
  assert.equal(formatWorkforceDuration(3600), "1 ч");
  assert.equal(formatWorkforceDuration(90061), "25 ч 1 мин");
  assert.equal(formatWorkforceDuration(-1), "—");
  assert.equal(formatWorkforceDuration(Number.NaN), "—");
});
test("factual timestamps use Moscow rather than the viewer timezone", () => {
  assert.match(
    workforceDateTime("2026-10-23T22:01:00Z"),
    /24 окт.*2026.*01:01/,
  );
  assert.equal(workforceDateTime(null), "—");
  assert.equal(workforceDateTime("invalid"), "—");
});
test("events describe completed operations; pagination retains an empty first page", () => {
  assert.equal(workEventTitle("box_packed"), "Упакован короб");
  assert.equal(
    workEventTitle("receipt_pallet_placed"),
    "Размещена входящая паллета",
  );
  assert.equal(workforcePages(0, 25), 1);
  assert.equal(workforcePages(26, 25), 2);
});

test("totals preserve actual packed units, fractional seconds, and zero employees without mutating source", () => {
  const employee = (
    id: string,
    boxesPacked: number,
    unitsPacked: number,
    workingSeconds: number,
  ): EmployeePerformanceDto => ({
    employeeId: id,
    employeeName: id,
    status: "off",
    currentShift: null,
    currentJobs: [],
    metrics: {
      boxesPacked,
      unitsPacked,
      receiptPalletsPlaced: 1,
      putawayBoxesPlaced: 2,
      movementPalletsPlaced: 3,
      workingSeconds,
      breakSeconds: 30,
    },
  });
  const rows = [
    employee("first", 1, 20, 30.8),
    employee("second", 1, 12, 29.8),
  ];
  const original = structuredClone(rows);
  const totals = workforceTotals(rows);
  assert.deepEqual(totals, {
    boxesPacked: 2,
    unitsPacked: 32,
    receiptPalletsPlaced: 2,
    putawayBoxesPlaced: 4,
    movementPalletsPlaced: 6,
    workingSeconds: 60.6,
    breakSeconds: 60,
  });
  assert.deepEqual(rows, original);
  assert.equal(formatWorkforceDuration(totals.workingSeconds), "1 мин");
  assert.equal(hasWorkforceFacts(totals), true);
  assert.equal(hasWorkforceFacts(workforceTotals([])), false);
});

test("history coverage distinguishes an untracked period from partially tracked and fully tracked dates", () => {
  const since = "2026-10-23T22:00:00Z"; // October 24, 01:00 Moscow.
  assert.equal(workforceCoverage("2026-10-01", "2026-10-23", since), "before");
  assert.equal(workforceCoverage("2026-10-24", "2026-10-24", since), "partial");
  assert.equal(workforceCoverage("2026-10-20", "2026-10-30", since), "partial");
  assert.equal(workforceCoverage("2026-10-25", "2026-10-30", since), "covered");
  assert.equal(
    workforceCoverage("2026-10-24", "2026-10-24", "2026-10-23T21:00:00Z"),
    "covered",
  );
});
