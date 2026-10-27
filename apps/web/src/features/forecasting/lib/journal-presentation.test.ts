import { test } from "node:test";
import assert from "node:assert/strict";
import {
  journalChart,
  journalDate,
  journalStatus,
} from "./journal-presentation";
import type { ForecastJournalComparedRowDto } from "@/entities/forecast";
test("saved chart overlays immutable predictions and partial facts for the same dates", () => {
  const row = {
    provider: "ozon",
    modelLabel: "Средний спрос",
    scoredDays: 1,
    points: [
      { date: "2026-10-28", predicted: 5, actual: 0 },
      { date: "2026-10-29", predicted: 6, actual: null },
    ],
  } as ForecastJournalComparedRowDto;
  const source = journalChart(row);
  assert.equal(source.predictedUnits, 11);
  assert.equal(source.historyDays, 1);
  assert.deepEqual(source.points, [
    { date: "2026-10-28", predicted: 5, actual: 0 },
    { date: "2026-10-29", predicted: 6, actual: null },
  ]);
  assert.match(journalDate("2026-10-27T21:30:00Z"), /28/);
  assert.match(journalStatus("same_day"), /вне оценки/);
});
