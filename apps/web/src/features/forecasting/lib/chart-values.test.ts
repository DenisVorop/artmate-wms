import { test } from "node:test";
import assert from "node:assert/strict";
import { chartActualValue } from "./chart-values";
import { forecastChart } from "./chart";
import { chartRangeBounds, presetChartRange } from "./chart-period";
const point = { date: "2026-10-29", actual: null, predicted: 13.52 };
test("actual tooltip distinguishes known zero, unknown past, current day and future", () => {
  assert.equal(chartActualValue(point, "2026-10-27"), "Будущая дата");
  assert.equal(
    chartActualValue({ ...point, date: "2026-10-27" }, "2026-10-27"),
    "День ещё идёт",
  );
  assert.equal(
    chartActualValue({ ...point, date: "2026-10-26" }, "2026-10-27"),
    "Нет данных",
  );
  assert.equal(
    chartActualValue({ ...point, actual: 0 }, "2026-10-27"),
    "0 шт.",
  );
  assert.equal(
    chartActualValue({ ...point, actual: 7 }, "2026-10-27"),
    "7 шт.",
  );
});
test("saved predictions in past do not move the current chart range or forecast shading back", () => {
  const source = {
    forecastFrom: "2026-10-27",
    points: [
      { date: "2025-01-01", actual: 2, predicted: 3 },
      { date: "2026-10-26", actual: 4, predicted: 5 },
      { date: "2026-11-25", actual: null, predicted: 6 },
    ],
  };
  assert.equal(chartRangeBounds([source]).anchor, "2026-10-26");
  const range = presetChartRange([source], "month");
  assert.deepEqual(range, { from: "2026-09-27", to: "2026-11-25" });
  const chart = forecastChart(source.points, range, source.forecastFrom);
  assert.equal(chart.forecastStartX, chart.xForDate("2026-10-27"));
  assert.equal(
    forecastChart(
      source.points,
      { from: "2025-01-01", to: "2025-02-01" },
      source.forecastFrom,
    ).forecastStartX,
    null,
  );
});
