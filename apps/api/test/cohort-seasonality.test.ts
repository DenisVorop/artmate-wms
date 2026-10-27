import assert from "node:assert/strict";
import test from "node:test";
import {
  categorySeasonalScenario,
  ownSeasonalScenario,
} from "../src/forecasting/cohort-seasonality";
import type {
  ForecastPoint,
  ForecastSeries,
} from "../src/forecasting/engine-types";

const DAY = 86_400_000;
function points(
  from: string,
  to: string,
  value: (date: string) => number,
): ForecastPoint[] {
  const result: ForecastPoint[] = [];
  for (let day = Date.parse(from); day <= Date.parse(to); day += DAY) {
    const date = new Date(day).toISOString().slice(0, 10);
    result.push({ date, units: value(date), availability: "available" });
  }
  return result;
}
function series(id: string, observations: ForecastPoint[]): ForecastSeries {
  return {
    id,
    externalId: id,
    provider: "ozon",
    storeId: "store",
    metric: "net_ordered",
    points: observations,
  };
}
const target = () =>
  series(
    "new-coloring",
    points("2026-09-01", "2026-10-26", () => 10),
  );
const donors = (factor = 2) =>
  [1, 10, 100].map((volume, index) =>
    series(
      `mature-${index}`,
      points("2025-01-01", "2026-01-31", (date) =>
        date >= "2025-11-01" && date <= "2025-12-31" ? volume * factor : volume,
      ),
    ),
  );
const options = {
  asOf: "2026-10-26",
  horizonDays: 90,
  baselineHistoryDays: 89,
};

test("category shape uses only relative donor volume and stays continuous beyond 30 days", () => {
  const result = categorySeasonalScenario(target(), donors(), options);
  assert.ok(result);
  assert.equal(result.scenario, true);
  assert.equal(result.donors, 3);
  assert.equal(result.dailyForecast.length, 90);
  assert.equal(
    result.dailyForecast.find((p) => p.date === "2026-12-15")!.units,
    20,
  );
  assert.equal(result.dailyForecast[29].units, 20);
  assert.equal(result.dailyForecast[30].units, 20);
  assert.equal(
    result.dailyForecast.find((p) => p.date === "2027-01-15")!.units,
    10,
  );
});

test("historical decline is allowed and December never forces growth", () => {
  const declining = categorySeasonalScenario(target(), donors(0.5), options);
  assert.ok(declining);
  assert.equal(
    declining.dailyForecast.find((p) => p.date === "2026-12-15")!.units,
    5,
  );
  assert.equal(categorySeasonalScenario(target(), donors(1), options), null);
});

test("already elevated current target level is normalized rather than multiplied twice", () => {
  const current = series(
    "new-coloring",
    points("2026-10-01", "2026-11-30", () => 20),
  );
  const result = categorySeasonalScenario(current, donors(), {
    ...options,
    asOf: "2026-11-30",
    horizonDays: 30,
  });
  // Last year's November and December are equally elevated: no additional uplift.
  assert.ok(result);
  assert.equal(result.dailyForecast[0].units, 20);
  assert.ok(result.dailyForecast.every((point) => point.units <= 20));
});

test("target recent demand calibrates absolute volume independently of donor sizes", () => {
  const current = series(
    "new-coloring",
    points("2026-09-01", "2026-10-26", (date) =>
      date >= "2026-10-20" ? 20 : 10,
    ),
  );
  const result = categorySeasonalScenario(current, donors(), options);
  assert.ok(result);
  assert.ok(result.referenceLevel > 12.5 && result.referenceLevel < 20);
  assert.equal(
    result.dailyForecast.find((p) => p.date === "2026-12-15")!.units,
    result.referenceLevel * 2,
  );
});

test("requires two distinct same-store/provider/metric donor products", () => {
  const valid = donors();
  const invalid = [
    { ...valid[2], storeId: "another-store" },
    { ...valid[2], provider: "wildberries" },
    { ...valid[2], metric: "sold" },
    { ...valid[2], externalId: target().externalId },
    valid[0],
  ];
  for (const donor of invalid)
    assert.equal(
      categorySeasonalScenario(target(), [valid[0], donor], options),
      null,
    );
});

test("future poisoning changes neither target level nor donor coefficients", () => {
  const future = points("2026-10-27", "2027-01-31", () => 1e8);
  const expected = categorySeasonalScenario(target(), donors(), options);
  const poisoned = categorySeasonalScenario(
    { ...target(), points: [...target().points, ...future] },
    donors().map((donor) => ({
      ...donor,
      points: [...donor.points, ...future],
    })),
    options,
  );
  assert.deepEqual(poisoned, expected);
});

test("stockout and missing target/previous-season donor days are never fabricated as zeros", () => {
  const sparse = target();
  sparse.points = sparse.points.map((point) => ({ ...point, units: null }));
  assert.equal(categorySeasonalScenario(sparse, donors(), options), null);
  for (const censor of ["missing", "out_of_stock"] as const) {
    const corrupted = donors();
    for (const donor of corrupted.slice(1))
      donor.points = donor.points.map((point) =>
        point.date >= "2025-12-10" && point.date <= "2025-12-20"
          ? {
              ...point,
              units: censor === "missing" ? null : point.units,
              availability:
                censor === "out_of_stock" ? "out_of_stock" : point.availability,
            }
          : point,
      );
    assert.equal(categorySeasonalScenario(target(), corrupted, options), null);
  }
});

test("known zero prior seasonal sales remain zero; no artificial lower floor", () => {
  const result = categorySeasonalScenario(target(), donors(0), options);
  assert.ok(result);
  assert.equal(
    result.dailyForecast.find((point) => point.date === "2026-12-15")!.units,
    0,
  );
});

test("a single exceptional theme cannot force category growth or defeat a coherent majority", () => {
  const increasing = donors(2);
  increasing[2] = donors(100)[2];
  const result = categorySeasonalScenario(target(), increasing, options);
  assert.equal(
    result?.dailyForecast.find((point) => point.date === "2026-12-15")!.units,
    20,
  );
  const incoherent = donors(1);
  incoherent[0] = donors(2)[0];
  incoherent[1] = donors(0.5)[1];
  assert.equal(categorySeasonalScenario(target(), incoherent, options), null);
});

function ownTarget(factor = 2) {
  return series("own-product", [
    ...donors(factor)[0].points,
    ...target().points,
  ]);
}

test("own observed season uses current level and the same shape throughout the horizon", () => {
  const result = ownSeasonalScenario(ownTarget(), options);
  assert.ok(result);
  assert.equal(result.scenario, true);
  assert.equal(result.referenceLevel, 10);
  assert.equal(result.dailyForecast[29].units, 20);
  assert.equal(result.dailyForecast[30].units, 20);
  assert.equal(
    result.dailyForecast.find((p) => p.date === "2027-01-15")!.units,
    10,
  );
  assert.equal(ownSeasonalScenario(target(), options), null);
});

test("own observed shape also allows decline, neutral December and real zero demand", () => {
  const december = (factor: number) =>
    ownSeasonalScenario(ownTarget(factor), options)?.dailyForecast.find(
      (point) => point.date === "2026-12-15",
    )!.units;
  assert.equal(december(0.5), 5);
  assert.equal(december(1), undefined);
  assert.equal(december(0), 0);
});

test("own scenario never looks at future observations or invents stockout/missing quantities", () => {
  const expected = ownSeasonalScenario(ownTarget(), options);
  assert.deepEqual(
    ownSeasonalScenario(
      {
        ...ownTarget(),
        points: [
          ...ownTarget().points,
          ...points("2026-10-27", "2027-01-31", () => 1e8),
        ],
      },
      options,
    ),
    expected,
  );
  for (const missing of [true, false]) {
    const corrupted = ownTarget();
    corrupted.points = corrupted.points.map((point) =>
      point.date >= "2025-12-10" && point.date <= "2025-12-20"
        ? {
            ...point,
            units: missing ? null : point.units,
            availability: missing ? point.availability : "out_of_stock",
          }
        : point,
    );
    assert.equal(ownSeasonalScenario(corrupted, options), null);
  }
});

test("own scenario calibrates against an already elevated matched period once", () => {
  const current = ownTarget();
  current.points = [
    ...donors()[0].points,
    ...points("2026-10-01", "2026-11-30", () => 20),
  ];
  const result = ownSeasonalScenario(current, {
    ...options,
    asOf: "2026-11-30",
    horizonDays: 25,
  });
  assert.equal(result, null);
});

test("own scenario requires complete supported horizon and a positive prior reference", () => {
  const noReference = ownTarget();
  noReference.points = noReference.points.map((point) =>
    point.date >= "2025-09-29" && point.date <= "2025-10-26"
      ? { ...point, units: 0 }
      : point,
  );
  assert.equal(ownSeasonalScenario(noReference, options), null);
  const noTail = ownTarget();
  noTail.points = noTail.points.filter(
    (point) =>
      point.date !== "2026-01-15" &&
      point.date !== "2026-01-16" &&
      point.date !== "2026-01-17",
  );
  assert.equal(ownSeasonalScenario(noTail, options), null);
});

test("launch growth cannot masquerade as annual seasonality for own product or category donors", () => {
  const immature = ownTarget();
  immature.points = immature.points.filter(
    (point) => point.date >= "2025-05-01",
  );
  assert.equal(ownSeasonalScenario(immature, options), null);
  const immatureDonors = donors().map((donor) => ({
    ...donor,
    points: donor.points.filter((point) => point.date >= "2025-05-01"),
  }));
  assert.equal(
    categorySeasonalScenario(target(), immatureDonors, options),
    null,
  );
});

test("maturity needs observed history and first trading, not prelaunch padded zero days", () => {
  for (const units of [null, 0]) {
    const padded = ownTarget();
    padded.points = padded.points.map((point) =>
      point.date < "2025-05-01" ? { ...point, units } : point,
    );
    assert.equal(ownSeasonalScenario(padded, options), null);
  }
  const missing = ownTarget();
  missing.points = missing.points.map((point) =>
    point.date >= "2025-05-01" && point.date <= "2025-08-01"
      ? { ...point, availability: "out_of_stock" }
      : point,
  );
  assert.equal(ownSeasonalScenario(missing, options), null);
});

test("two established peers require unanimous direction and use conservative growth", () => {
  const result = categorySeasonalScenario(
    target(),
    [donors(2)[0], donors(100)[1]],
    options,
  );
  assert.ok(result);
  assert.equal(result.donors, 2);
  assert.equal(
    result.dailyForecast.find((p) => p.date === "2026-12-15")!.units,
    20,
  );
  assert.equal(
    categorySeasonalScenario(target(), [donors(2)[0], donors(0.5)[1]], options),
    null,
  );
});

test("two established declining peers use the decline closest to unchanged demand", () => {
  const result = categorySeasonalScenario(
    target(),
    [donors(0.5)[0], donors(0.1)[1]],
    options,
  );
  assert.ok(result);
  assert.equal(
    result.dailyForecast.find((p) => p.date === "2026-12-15")!.units,
    5,
  );
});

test("a launch with 14 known recent days can borrow a mature category shape but fewer days cannot", () => {
  const launch = target();
  launch.points = launch.points.filter((point) => point.date >= "2026-10-13");
  const result = categorySeasonalScenario(launch, donors(), options);
  assert.ok(result);
  assert.equal(result.scenario, true);
  assert.equal(result.referenceLevel, 10);
  assert.equal(
    result.dailyForecast.find((p) => p.date === "2026-12-15")!.units,
    20,
  );
  launch.points = launch.points.filter((point) => point.date >= "2026-10-14");
  assert.equal(categorySeasonalScenario(launch, donors(), options), null);
});

test("matching current and prior week-on-month growth uses identical robust calibration on both sides", () => {
  const curve = (date: string) =>
    date >= "2025-10-20" || date >= "2026-10-20" ? 20 : 10;
  const prior = points("2025-01-01", "2026-01-31", curve);
  const current = points("2026-09-01", "2026-10-26", (date) =>
    date >= "2026-10-20" ? 20 : 10,
  );
  const own = ownSeasonalScenario(
    series("own", [...prior, ...current]),
    options,
  );
  assert.ok(own);
  assert.ok(
    Math.abs(
      own.dailyForecast.find((p) => p.date === "2026-11-15")!.units - 20,
    ) < 1e-6,
  );
  const category = categorySeasonalScenario(
    series("new", current),
    [series("peer-one", prior), series("peer-two", prior)],
    options,
  );
  assert.ok(category);
  assert.ok(
    Math.abs(
      category.dailyForecast.find((p) => p.date === "2026-11-15")!.units - 20,
    ) < 1e-6,
  );
});

test("a flat own annual profile or a few noisy days is not claimed as seasonal evidence", () => {
  assert.equal(ownSeasonalScenario(ownTarget(1), options), null);
  const noise = ownTarget(1);
  noise.points = noise.points.map((point) =>
    point.date === "2025-12-15" ? { ...point, units: 1.1 } : point,
  );
  assert.equal(ownSeasonalScenario(noise, options), null);
});
