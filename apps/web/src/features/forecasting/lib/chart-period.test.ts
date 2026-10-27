import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chartRangeBounds,
  filterChartPoints,
  isValidChartRange,
  presetChartRange,
} from "./chart-period";
import { chartTotals, forecastChart } from "./chart";

test("periods use inclusive calendar days across leap day and clamp to available dates", () => {
  const sources = [
    {
      points: [
        { date: "2023-01-01", actual: 3, predicted: null },
        { date: "2024-02-29", actual: 0, predicted: null },
        { date: "2024-03-01", actual: null, predicted: 4 },
        { date: "2024-04-30", actual: null, predicted: 4 },
      ],
    },
  ];
  assert.deepEqual(chartRangeBounds(sources), {
    first: "2023-01-01",
    last: "2024-04-30",
    anchor: "2024-02-29",
  });
  assert.deepEqual(presetChartRange(sources, "month"), {
    from: "2024-01-31",
    to: "2024-03-30",
  });
  assert.deepEqual(presetChartRange(sources, "quarter"), {
    from: "2023-12-02",
    to: "2024-03-30",
  });
  assert.deepEqual(presetChartRange(sources, "year"), {
    from: "2023-03-02",
    to: "2024-03-30",
  });
  assert.deepEqual(presetChartRange(sources, "all"), {
    from: "2023-01-01",
    to: "2024-04-30",
  });
});

test("bounds share the earliest forecast boundary across sources independent of order", () => {
  const sources = [
    {
      points: [
        { date: "2026-11-02", actual: null, predicted: 2 },
        { date: "2026-10-30", actual: 8, predicted: null },
      ],
    },
    {
      points: [
        { date: "2026-10-31", actual: 7, predicted: 0 },
        { date: "2026-10-01", actual: 0, predicted: null },
      ],
    },
  ];
  assert.deepEqual(chartRangeBounds(sources), {
    first: "2026-10-01",
    last: "2026-11-02",
    anchor: "2026-10-30",
  });
});

test("future-only, actual-only, unknown-only and empty data have deterministic ranges", () => {
  const future = [
    {
      points: [
        { date: "2026-11-01", actual: null, predicted: 0 },
        { date: "2026-12-10", actual: null, predicted: 0 },
      ],
    },
  ];
  assert.deepEqual(presetChartRange(future, "month"), {
    from: "2026-11-01",
    to: "2026-11-30",
  });
  const actual = [
    {
      points: [
        { date: "2026-10-01", actual: 1, predicted: null },
        { date: "2026-10-15", actual: 0, predicted: null },
        { date: "2026-10-30", actual: null, predicted: null },
      ],
    },
  ];
  assert.equal(chartRangeBounds(actual).anchor, "2026-10-15");
  assert.deepEqual(presetChartRange(actual, "year"), {
    from: "2026-10-01",
    to: "2026-10-30",
  });
  assert.deepEqual(
    chartRangeBounds([
      { points: [{ date: "2026-10-03", actual: null, predicted: null }] },
    ]),
    {
      first: "2026-10-03",
      last: "2026-10-03",
      anchor: "2026-10-03",
    },
  );
  assert.deepEqual(chartRangeBounds([]), { first: "", last: "", anchor: "" });
  assert.deepEqual(presetChartRange([{ points: [] }], "month"), {
    from: "",
    to: "",
  });
});

test("custom range is inclusive and never mutates or fills missing observations", () => {
  const points = [
    { date: "2024-02-28", actual: 4, predicted: null },
    { date: "2024-02-29", actual: 0, predicted: null },
    { date: "2024-03-01", actual: null, predicted: null },
    { date: "2024-03-02", actual: null, predicted: 5 },
  ];
  const original = structuredClone(points);
  const filtered = filterChartPoints(points, {
    from: "2024-02-29",
    to: "2024-03-01",
  });
  assert.deepEqual(filtered, points.slice(1, 3));
  assert.deepEqual(points, original);
  assert.equal(filtered[0], points[1]);
  assert.equal(
    isValidChartRange({ from: "2024-02-29", to: "2024-02-29" }),
    true,
  );
  for (const range of [
    { from: "2024-03-02", to: "2024-02-29" },
    { from: "2023-02-29", to: "2024-03-01" },
    { from: "2024-02-30", to: "2024-03-01" },
    { from: "2024-2-01", to: "2024-03-01" },
    { from: "", to: "2024-03-01" },
  ]) {
    assert.equal(isValidChartRange(range), false);
    assert.deepEqual(filterChartPoints(points, range), []);
  }
});

test("geometry uses calendar distance and breaks lines across omitted days and nulls", () => {
  const points = [
    { date: "2026-10-04", actual: 2, predicted: null },
    { date: "2026-10-01", actual: 4, predicted: null },
    { date: "2026-10-05", actual: null, predicted: 0 },
    { date: "2026-10-06", actual: null, predicted: null },
    { date: "2026-10-07", actual: null, predicted: 2 },
  ];
  const original = structuredClone(points),
    chart = forecastChart(points);
  assert.equal(chart.width, 640);
  assert.equal(chart.height, 220);
  assert.equal(chart.pad, 12);
  assert.equal(chart.points[0].date, "2026-10-01");
  assert.equal(chart.points[1].x, (chart.points[0].x + chart.points[4].x) / 2);
  assert.equal((chart.actual.match(/M/g) ?? []).length, 2);
  assert.equal(chart.actual.includes("L"), false);
  assert.equal((chart.predicted.match(/M/g) ?? []).length, 2);
  assert.equal(chart.forecastStartX, chart.xForDate("2026-10-05"));
  assert.equal(chart.points[2].predictedY, chart.height - chart.pad);
  assert.equal(chart.points[2].actualY, null);
  assert.equal(chart.ticks.length, 4);
  assert.deepEqual(
    chart.ticks.map((tick) => tick.value),
    [4, 8 / 3, 4 / 3, 0],
  );
  assert.equal(chart.yForValue(chart.max), chart.pad);
  assert.deepEqual(points, original);
});

test("flat forecast values stay flat and zero remains a known observed value", () => {
  const points = [
    { date: "2026-10-01", actual: 0, predicted: null },
    { date: "2026-10-02", actual: null, predicted: 0 },
    { date: "2026-10-03", actual: null, predicted: 0 },
    { date: "2026-10-04", actual: null, predicted: 0 },
  ];
  const chart = forecastChart(points);
  assert.equal(chart.max, 1);
  assert.equal(chart.hasData, true);
  assert.equal(chart.points[0].actualY, 208);
  assert.equal(
    new Set(chart.points.slice(1).map((point) => point.predictedY)).size,
    1,
  );
  assert.deepEqual(chartTotals(points), {
    actual: 0,
    predicted: 0,
    actualDays: 1,
    predictedDays: 3,
    flatForecast: true,
    dailyForecast: 0,
  });
  assert.deepEqual(chartTotals([]), {
    actual: null,
    predicted: null,
    actualDays: 0,
    predictedDays: 0,
    flatForecast: false,
    dailyForecast: null,
  });
  assert.equal(forecastChart([]).forecastStartX, null);
  assert.equal(
    forecastChart([{ date: "2026-10-01", actual: null, predicted: null }])
      .hasData,
    false,
  );
});

test("totals count only known values inside the selected period", () => {
  const points = [
    { date: "2026-10-01", actual: 20, predicted: null },
    { date: "2026-10-02", actual: 0, predicted: null },
    { date: "2026-10-03", actual: null, predicted: 2 },
    { date: "2026-10-04", actual: null, predicted: null },
    { date: "2026-10-05", actual: null, predicted: 4 },
  ];
  assert.deepEqual(
    chartTotals(
      filterChartPoints(points, { from: "2026-10-02", to: "2026-10-05" }),
    ),
    {
      actual: 0,
      predicted: 6,
      actualDays: 1,
      predictedDays: 2,
      flatForecast: false,
      dailyForecast: 3,
    },
  );
  assert.equal(chartTotals(points.slice(0, 3)).flatForecast, false);
  assert.equal(
    chartTotals([
      { date: "2026-10-01", actual: null, predicted: 2 },
      { date: "2026-10-02", actual: null, predicted: 2 + 1e-10 },
    ]).flatForecast,
    true,
  );
});

test("a shared date domain aligns sparse financial points with longer forecast sources", () => {
  const range = { from: "2026-10-27", to: "2027-02-09" };
  const financePoints = [
    { date: "2026-11-01", actual: 3, predicted: null },
    { date: "2026-11-25", actual: 0, predicted: null },
  ];
  const finance = forecastChart(financePoints, range);
  const orders = forecastChart(
    [
      { date: "2026-10-27", actual: 1, predicted: null },
      ...financePoints,
      { date: "2027-02-09", actual: null, predicted: 2 },
    ],
    range,
  );
  for (const point of finance.points) {
    assert.equal(point.x, orders.xForDate(point.date));
    assert.equal(
      point.x,
      orders.points.find((other) => other.date === point.date)!.x,
    );
  }
  assert.equal(finance.xForDate(range.from), finance.pad);
  assert.equal(finance.xForDate(range.to), finance.width - finance.pad);
  assert.ok(finance.points[1].x < finance.width - finance.pad);
  assert.equal(finance.points.length, financePoints.length);
  assert.equal(forecastChart([], range).points.length, 0);
  assert.equal(
    forecastChart([], range).xForDate(range.to),
    finance.width - finance.pad,
  );
  const withoutDomain = forecastChart(financePoints);
  assert.equal(withoutDomain.points[0].x, withoutDomain.pad);
  assert.equal(
    withoutDomain.points[1].x,
    withoutDomain.width - withoutDomain.pad,
  );
  assert.deepEqual(
    forecastChart(financePoints, { from: "invalid", to: range.to }).points,
    withoutDomain.points,
  );
  assert.deepEqual(
    forecastChart(financePoints, { from: range.to, to: range.from }).points,
    withoutDomain.points,
  );
});

test("a one-day display keeps its actual value and centers the visible observation", () => {
  const range = { from: "2026-10-25", to: "2026-10-25" };
  const selected = filterChartPoints(
    [
      { date: "2026-10-24", actual: 999, predicted: null },
      { date: "2026-10-25", actual: 0, predicted: null },
    ],
    range,
  );
  const chart = forecastChart(selected, range);
  assert.equal(chart.points.length, 1);
  assert.equal(chart.points[0].x, chart.width / 2);
  assert.equal(chart.points[0].actual, 0);
  assert.equal(chart.hasData, true);
  assert.equal(chartTotals(selected).actual, 0);
});
