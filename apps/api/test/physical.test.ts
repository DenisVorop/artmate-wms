import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assemblyMetrics,
  DEMO_PACKAGING,
  finishedMetrics,
  packagingError,
  placementError,
  putawayPlacementError,
  samePackaging,
} from "../src/physical";
import { ValidationPipe } from "@nestjs/common";
import { PackagingProfileDto } from "../src/dto";
import type * as D from "../src/dto";

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

const overhanging: D.PackagingProfileDto = {
  ...DEMO_PACKAGING,
  boxWidthMm: 450,
  boxDepthMm: 350,
  boxHeightMm: 200,
  loadWidthMm: 1200,
  loadDepthMm: 900,
  boxesPerLayer: 6,
  maxLayers: 7,
};
function storage(width = 900, height = 2200) {
  const location = {
    id: "storage",
    kind: "floor",
    archived: false,
    blocked: false,
    availableWidthMm: width,
    availableDepthMm: 1250,
    maxHeightMm: height,
    maxWeightKg: null,
    maxBoxes: 42,
  } as D.LocationDto;
  const state = {
    locations: [location],
    sections: [],
    pallets: [],
    movements: [],
    putawayTasks: [],
    boxes: [],
  } as unknown as D.WorkspaceDto;
  return { state, location };
}
test("declared loaded footprint permits six real boxes per layer without changing the euro wooden base", () => {
  const previous = JSON.stringify(overhanging);
  assert.equal(packagingError(overhanging), null);
  assert.match(
    packagingError({ ...overhanging, loadDepthMm: 800 })!,
    /слой коробов/,
  );
  assert.deepEqual(finishedMetrics(overhanging, 42), {
    widthMm: 1200,
    depthMm: 900,
    heightMm: 1550,
    weightKg: null,
  });
  assert.deepEqual(finishedMetrics(overhanging, 0), {
    widthMm: 1200,
    depthMm: 800,
    heightMm: 150,
    weightKg: null,
  });
  assert.equal(overhanging.palletWidthMm, 1200);
  assert.equal(overhanging.palletDepthMm, 800);
  assert.equal(JSON.stringify(overhanging), previous);
  for (const patch of [
    { loadWidthMm: 1199 },
    { loadDepthMm: 799 },
    { loadDepthMm: NaN },
    { loadDepthMm: null as unknown as number },
  ])
    assert.notEqual(packagingError({ ...overhanging, ...patch }), null);
});
test("loaded42 fits900mm address but is rejected by875mm clearance and1500mm height", () => {
  const metrics = {
    ...finishedMetrics(overhanging, 42),
    kind: "finished",
    quantity: 42,
  };
  const wide = storage();
  assert.equal(placementError(wide.state, wide.location, metrics), null);
  const narrow = storage(875);
  assert.match(
    placementError(narrow.state, narrow.location, metrics)!,
    /ширине и глубине/,
  );
  const low = storage(900, 1500);
  assert.match(placementError(low.state, low.location, metrics)!, /по высоте/);
  assert.match(
    placementError(wide.state, { ...wide.location, maxBoxes: 41 }, metrics)!,
    /вместимость/,
  );
});
test("legacy snapshots normalize omitted load dimensions to the base but new overhang remains a distinct profile", () => {
  const old = { ...DEMO_PACKAGING };
  const previous = JSON.stringify(old);
  assert.equal(
    samePackaging(old, { ...old, loadWidthMm: 1200, loadDepthMm: 800 }),
    true,
  );
  assert.equal(
    samePackaging(old, { ...old, loadWidthMm: 1200, loadDepthMm: 900 }),
    false,
  );
  assert.equal(JSON.stringify(old), previous);
});
test("putaway reserves the loaded envelope and refuses a43rdbox or an incompatible historical profile", () => {
  const { state, location } = storage();
  const box = {
    id: "next",
    code: "next",
    skuId: "cats",
    packagingSnapshot: { ...overhanging },
  } as D.BoxDto;
  state.pallets.push({
    id: "pallet",
    kind: "finished",
    status: "stored",
    skuId: "cats",
    locationId: location.id,
    returnLocationId: null,
    quantity: 41,
    packagingSnapshot: { ...overhanging },
    ...finishedMetrics(overhanging, 41),
  } as D.PalletDto);
  assert.equal(putawayPlacementError(state, location, box), null);
  assert.match(
    putawayPlacementError(state, { ...location, availableWidthMm: 875 }, box)!,
    /ширине и глубине/,
  );
  state.pallets[0].quantity = 42;
  assert.match(putawayPlacementError(state, location, box)!, /заполнена/);
  state.pallets[0].quantity = 1;
  state.pallets[0].packagingSnapshot = { ...DEMO_PACKAGING };
  assert.match(
    putawayPlacementError(state, location, box)!,
    /другой тематики или профиля/,
  );
});
test("finished putaway keeps a mixed box with the oldest receipt lot", () => {
  const { state, location } = storage();
  const old = {
    id: "old",
    skuId: "cats",
    name: "Old",
    receivedAt: "2026-10-01",
  };
  const recent = {
    id: "recent",
    skuId: "cats",
    name: "New",
    receivedAt: "2026-10-02",
  };
  state.lots = [recent, old];
  const box = (lotId: string) => ({
    skuId: "cats",
    lotContents: [{ lotId, quantity: 20 }],
    packagingSnapshot: overhanging,
  });
  const mixed = {
    ...box(old.id),
    lotContents: [
      { lotId: recent.id, quantity: 10 },
      { lotId: old.id, quantity: 10 },
    ],
  };
  state.pallets.push({
    id: "pallet",
    kind: "finished",
    status: "stored",
    skuId: "cats",
    locationId: location.id,
    returnLocationId: null,
    quantity: 1,
    packagingSnapshot: overhanging,
    ...finishedMetrics(overhanging, 1),
  } as D.PalletDto);
  state.boxes.push({
    ...box(old.id),
    palletId: "pallet",
    status: "stored",
  } as D.BoxDto);
  assert.equal(putawayPlacementError(state, location, mixed), null);
  assert.match(
    putawayPlacementError(state, location, box(recent.id))!,
    /другого тиража/,
  );
});

test("putaway accepts legacy pallet lots of one receipt and rejects other receipts for stored and incoming stock", () => {
  const { state, location } = storage();
  state.lots = ["a", "b", "other"].map((id) => ({
    id,
    skuId: "cats",
    name: "Same name",
    receivedAt: "2026-11-16T14:32:00.000Z",
  }));
  state.receipts = [
    {
      id: "receipt-one",
      pallets: [
        { palletId: "raw-a", skuId: "cats" },
        { palletId: "raw-b", skuId: "cats" },
      ],
    },
    {
      id: "receipt-other",
      pallets: [{ palletId: "raw-other", skuId: "cats" }],
    },
  ] as D.ReceiptDto[];
  state.pallets = ["a", "b", "other"].map((id) => ({
    id: `raw-${id}`,
    kind: "raw",
    status: "retired",
    skuId: "cats",
    lotId: id,
    quantity: 0,
  })) as D.PalletDto[];
  const box = (lotId: string) => ({
    id: `box-${lotId}`,
    skuId: "cats",
    lotContents: [{ lotId, quantity: 20 }],
    packagingSnapshot: overhanging,
  });
  const target = {
    id: "target",
    kind: "finished",
    status: "stored",
    skuId: "cats",
    locationId: location.id,
    returnLocationId: null,
    packagingSnapshot: overhanging,
    ...finishedMetrics(overhanging, 1),
    quantity: 1,
  } as D.PalletDto;
  state.pallets.push(target);
  state.boxes.push({
    ...box("a"),
    palletId: target.id,
    status: "stored",
  } as D.BoxDto);
  const before = JSON.stringify(state);
  assert.equal(putawayPlacementError(state, location, box("b")), null);
  assert.match(
    putawayPlacementError(state, location, box("other"))!,
    /другого тиража/,
  );
  assert.equal(JSON.stringify(state), before);
  location.maxBoxes = 1;
  assert.match(
    putawayPlacementError(state, location, box("b"))!,
    /вместимость/,
  );
  location.maxBoxes = 42;
  state.pallets = state.pallets.filter((p) => p.id !== target.id);
  state.boxes[0] = { ...box("a"), status: "in_transit" } as D.BoxDto;
  state.putawayTasks = [
    {
      id: "incoming",
      boxId: "box-a",
      toLocationId: location.id,
      status: "in_transit",
    },
  ] as D.PutawayTaskDto[];
  assert.equal(putawayPlacementError(state, location, box("b")), null);
  assert.match(
    putawayPlacementError(state, location, box("other"))!,
    /для другого тиража/,
  );
});

test("mixed accumulator includes explicit loaded dimensions but an empty pallet keeps its wooden base", () => {
  const base = { ...DEMO_PACKAGING };
  const profiles = Array.from({ length: 42 }, () => ({ ...overhanging }));
  const before = JSON.stringify([base, profiles]);
  const metrics = assemblyMetrics(base, profiles);
  assert.equal(metrics.widthMm, 1200);
  assert.equal(metrics.depthMm, 900);
  assert.equal(metrics.heightMm, 1550);
  assert.equal(metrics.capacity, 42);
  assert.equal(metrics.error, null);
  assert.match(
    assemblyMetrics(base, [...profiles, overhanging]).error!,
    /заполнена/,
  );
  assert.equal(assemblyMetrics(overhanging, []).depthMm, 800);
  assert.equal(JSON.stringify([base, profiles]), before);
});
test("transport accepts optional loaded dimensions but rejects null, strings and a footprint smaller than the base", async () => {
  const pipe = new ValidationPipe({
    expectedType: PackagingProfileDto,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const parsed = await pipe.transform({ ...overhanging }, { type: "body" });
  assert.equal(parsed.loadDepthMm, 900);
  const legacy = await pipe.transform({ ...DEMO_PACKAGING }, { type: "body" });
  assert.equal(legacy.loadDepthMm, undefined);
  for (const patch of [
    { loadWidthMm: 1199 },
    { loadDepthMm: 799 },
    { loadDepthMm: null },
    { loadDepthMm: "900" },
    { loadDepthMm: 900.5 },
    { loadDepthMm: Infinity },
    { loadWidthMm: 5001 },
  ])
    await assert.rejects(
      pipe.transform({ ...overhanging, ...patch }, { type: "body" }),
    );
});
