import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { assemblyMetrics, DEMO_PACKAGING } from "../src/physical";

test("mixed grid conservatively uses widest/deepest/tallest snapshots and fixed base without mutating profiles", () => {
  const base = { ...DEMO_PACKAGING, palletWeightKg: 20 };
  const a = { ...base, boxWeightKg: 2 },
    b = {
      ...base,
      palletWidthMm: 2000,
      boxWidthMm: 600,
      boxHeightMm: 500,
      boxesPerLayer: 4,
      maxLayers: 3,
      boxWeightKg: 5,
    };
  const before = JSON.stringify([base, a, b]);
  const result = assemblyMetrics(base, [a, a, a, a, b]);
  assert.equal(result.widthMm, 1200);
  assert.equal(result.depthMm, 800);
  assert.equal(result.heightMm, 1150);
  assert.equal(result.weightKg, 33);
  assert.equal(result.capacity, 12);
  assert.equal(result.quantity, 5);
  assert.equal(result.error, null);
  assert.equal(JSON.stringify([base, a, b]), before);
});
test("mixed grid rejects unfit boxes and layer overflow, keeps unknown mass and preserves an empty physical base", () => {
  const base = { ...DEMO_PACKAGING, palletWeightKg: 15 };
  const oversize = { ...base, boxWidthMm: 1300, boxDepthMm: 900 };
  assert.match(assemblyMetrics(base, [oversize]).error!, /не помещается/);
  const layer = { ...base, maxLayers: 1 };
  assert.match(
    assemblyMetrics(
      base,
      Array.from({ length: 7 }, () => layer),
    ).error!,
    /заполнена/,
  );
  assert.equal(
    assemblyMetrics(base, [{ ...base, boxWeightKg: null }]).weightKg,
    null,
  );
  const empty = assemblyMetrics(base, []);
  assert.equal(empty.widthMm, 1200);
  assert.equal(empty.depthMm, 800);
  assert.equal(empty.heightMm, 150);
  assert.equal(empty.weightKg, 15);
  assert.equal(empty.quantity, 0);
  assert.equal(empty.error, null);
  const horizontal = {
      ...base,
      boxWidthMm: 800,
      boxDepthMm: 200,
      boxesPerLayer: 6,
    },
    vertical = { ...base, boxWidthMm: 200, boxDepthMm: 800, boxesPerLayer: 6 };
  assert.equal(assemblyMetrics(base, [horizontal, vertical]).heightMm, 750);
});
