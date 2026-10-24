import assert from "node:assert/strict";
import test from "node:test";
import {
  isWorkforceDate,
  moscowDay,
  workforcePeriod,
  workforcePeriodDays,
} from "./workforce-period";

test("Moscow day crosses midnight while UTC still belongs to the previous day", () => {
  assert.equal(moscowDay(new Date("2026-10-23T20:59:59Z")), "2026-10-23");
  assert.equal(moscowDay(new Date("2026-10-23T21:00:00Z")), "2026-10-24");
});
test("presets include today and cross month/year boundaries without local timezone arithmetic", () => {
  const now = new Date("2026-01-02T22:00:00Z");
  assert.deepEqual(workforcePeriod(7, now), {
    from: "2025-12-28",
    to: "2026-01-03",
  });
  const period = workforcePeriod(30, now);
  assert.equal(workforcePeriodDays(period.from, period.to), 30);
  assert.deepEqual(workforcePeriod(1, now), {
    from: "2026-01-03",
    to: "2026-01-03",
  });
});
test("calendar validation rejects normalized impossible dates and accepts leap days", () => {
  assert.equal(isWorkforceDate("2024-02-29"), true);
  for (const day of [
    "2025-02-29",
    "2026-04-31",
    "2026-13-01",
    "24.10.2026",
    "2026-1-01",
    "",
  ]) {
    assert.equal(isWorkforceDate(day), false, day);
  }
});
