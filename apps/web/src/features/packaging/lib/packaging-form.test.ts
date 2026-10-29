import assert from "node:assert/strict";
import { test } from "node:test";
import type { PackagingProfileDto } from "@/shared/api/generated/model";
import {
  buildPackaging,
  packagingDefaults,
  packagingSchema,
} from "./packaging-form";
const legacy: PackagingProfileDto = {
  boxWidthMm: 400,
  boxDepthMm: 400,
  boxHeightMm: 300,
  palletWidthMm: 1200,
  palletDepthMm: 800,
  palletBaseHeightMm: 150,
  boxesPerLayer: 6,
  maxLayers: 6,
  boxWeightKg: null,
  palletWeightKg: null,
};
test("old SKU profiles load with the base footprint without changing saved packaging", () => {
  const original = structuredClone(legacy);
  const values = packagingSchema.parse(packagingDefaults(legacy));
  assert.deepEqual([values.loadWidthMm, values.loadDepthMm], [1200, 800]);
  assert.equal(values.boxHeightMm, 300);
  assert.equal(values.maxLayers, 6);
  assert.deepEqual(legacy, original);
});
test("a 1200x900 loaded pallet retains the Euro base and confirmed 6x7 stack through save", () => {
  const profile = {
    ...legacy,
    boxWidthMm: 450,
    boxDepthMm: 350,
    boxHeightMm: 200,
    loadWidthMm: 1200,
    loadDepthMm: 900,
    maxLayers: 7,
  };
  const values = packagingSchema.parse(packagingDefaults(profile));
  assert.deepEqual(buildPackaging(values).packaging, profile);
  assert.equal(values.boxesPerLayer * values.maxLayers, 42);
  assert.deepEqual([values.palletWidthMm, values.palletDepthMm], [1200, 800]);
});
test("loaded dimensions must contain the base and be finite integer millimetres", () => {
  const good = packagingDefaults(legacy);
  for (const patch of [
    { loadWidthMm: 1199 },
    { loadDepthMm: 799 },
    { loadWidthMm: null },
    { loadDepthMm: NaN },
    { loadWidthMm: Infinity },
    { loadWidthMm: 1200.5 },
    { loadDepthMm: 5001 },
  ])
    assert.equal(
      packagingSchema.safeParse({ ...good, ...patch }).success,
      false,
    );
  assert.equal(
    packagingSchema.safeParse({ ...good, loadWidthMm: 1200, loadDepthMm: 900 })
      .success,
    true,
  );
});

test("a new packaging profile starts with the confirmed 450x350x200 boxes and 42-box Euro load", () => {
  const first = packagingSchema.parse(packagingDefaults());
  assert.deepEqual(
    [first.boxWidthMm, first.boxDepthMm, first.boxHeightMm],
    [450, 350, 200],
  );
  assert.deepEqual([first.palletWidthMm, first.palletDepthMm], [1200, 800]);
  assert.deepEqual([first.loadWidthMm, first.loadDepthMm], [1200, 900]);
  assert.equal(first.boxesPerLayer * first.maxLayers, 42);
  assert.equal(
    first.palletBaseHeightMm + first.maxLayers * first.boxHeightMm,
    1550,
  );
  first.loadDepthMm = 800;
  first.maxLayers = 1;
  assert.equal(packagingDefaults().loadDepthMm, 900);
  assert.equal(packagingDefaults().maxLayers, 7);
});
