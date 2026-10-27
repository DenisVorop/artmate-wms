import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateAddressesAndMovements } from "../src/migrations";
import { seedWorkspace } from "../src/seed";
import {
  openingStocktakePlan,
  openingLocationIssues,
  OPENING_MAX_BOXES,
} from "../src/opening-stocktake";
import { stocktakeRow } from "../src/stocktake-plan";
import type * as D from "../src/dto";
const clock = new Date("2026-10-27T10:00:00Z");
const doc = {
  id: "opening-document-one",
  code: "INV-0001",
  createdAt: "2026-10-27T09:00:00Z",
};
function fixture() {
  const state: D.WorkspaceDto = migrateAddressesAndMovements(seedWorkspace());
  state.pallets = [];
  state.boxes = [];
  state.tasks = [];
  state.movements = [];
  state.shipments = [];
  state.putawayTasks = [];
  state.receipts = [];
  const location = state.locations.find((entry) => entry.kind === "rack")!;
  const row = (
    openingPallet: D.OpeningPalletCountDto | null,
  ): D.StocktakeRowSnapshotDto => ({
    ...stocktakeRow(state, location.id, 0),
    countVersion: 0,
    count: { rawPallets: [], boxCodes: [], openingPallet },
  });
  const raw: D.OpeningPalletCountDto = {
    kind: "raw",
    skuId: "sku-cats",
    heightMm: 730,
    batches: [{ receivedAt: "2026-10-01T09:00:00+03:00", quantity: 1000 }],
  };
  const finished: D.OpeningPalletCountDto = {
    kind: "finished",
    skuId: "sku-cats",
    unitsPerBox: 20,
    batches: [
      { receivedAt: "2026-10-01T09:00:00Z", quantity: 2 },
      { receivedAt: "2026-10-20T09:00:00Z", quantity: 1 },
    ],
  };
  const run = (
    rows: D.StocktakeRowSnapshotDto[],
    versions = new Map<string, number>(),
  ) => openingStocktakePlan(state, rows, versions, 4, doc, clock);
  return { state, location, row, raw, finished, run };
}
test("opening raw stock is deterministic, Euro-sized and dated by observation without receipt or work facts", () => {
  const { state, row, raw, run } = fixture();
  const before = structuredClone(state);
  const first = run([row(raw)]),
    again = run([row(raw)]);
  assert.equal(
    first.preview.canApprove,
    true,
    JSON.stringify(first.preview.issues),
  );
  assert.deepEqual(first, again);
  assert.deepEqual(state, before);
  assert.equal(first.state!.pallets.length, 1);
  assert.equal(first.state!.lots.length, state.lots.length + 1);
  const pallet = first.state!.pallets[0];
  assert.equal(pallet.widthMm, 1200);
  assert.equal(pallet.depthMm, 800);
  assert.equal(pallet.heightMm, 730);
  assert.equal(pallet.quantity, 1000);
  assert.equal(pallet.openingStocktakeId, doc.id);
  assert.equal(
    first.state!.lots.find((lot) => lot.id === pallet.lotId)!.receivedAt,
    "2026-10-01T06:00:00.000Z",
  );
  assert.equal(first.preview.changes.length, 1);
  assert.equal(first.preview.changes[0].kind, "opening_raw");
  assert.equal(first.preview.unitsDelta, 1000);
  assert.equal(first.results[pallet.locationId!].palletId, pallet.id);
  assert.deepEqual(first.state!.receipts, state.receipts);
  assert.deepEqual(first.state!.tasks, state.tasks);
  assert.deepEqual(first.state!.employees, state.employees);
  assert.deepEqual(first.state!.activities, state.activities);
});
test("finished batches create real homogeneous boxes with original received dates and unknown packing dates", () => {
  const { state, row, finished, run } = fixture();
  const plan = run([row(finished)]);
  assert.equal(
    plan.preview.canApprove,
    true,
    JSON.stringify(plan.preview.issues),
  );
  assert.equal(plan.state!.boxes.length, 3);
  assert.equal(plan.preview.changes.length, 1);
  assert.equal(plan.preview.unitsDelta, 60);
  assert.equal(plan.preview.changes[0].kind, "opening_finished");
  const boxes = plan.state!.boxes;
  assert.equal(new Set(boxes.map((box) => box.id)).size, 3);
  assert.equal(new Set(boxes.map((box) => box.code)).size, 3);
  assert.ok(
    boxes.every(
      (box) =>
        box.packedAt === null &&
        box.registeredAt === clock.toISOString() &&
        box.openingStocktakeId === doc.id,
    ),
  );
  assert.deepEqual(
    boxes.map((box) => box.units),
    [20, 20, 20],
  );
  assert.deepEqual(
    boxes.map(
      (box) =>
        plan.state!.lots.find((lot) => lot.id === box.lotContents[0].lotId)!
          .receivedAt,
    ),
    [
      "2026-10-01T09:00:00.000Z",
      "2026-10-01T09:00:00.000Z",
      "2026-10-20T09:00:00.000Z",
    ],
  );
  assert.equal(plan.state!.pallets[0].heightMm, 450);
  assert.equal(plan.state!.pallets[0].lotId, null);
  assert.equal(
    plan.results[plan.state!.pallets[0].locationId!].boxIds.length,
    3,
  );
  assert.equal(state.boxes.length, 0);
});
test("marker boxes use their observed four or eight sets without changing SKU defaults", () => {
  for (const units of [4, 8]) {
    const { state, row, finished, run } = fixture();
    state.skus[0].unitsPerBox = 4;
    const plan = run([row({ ...finished, unitsPerBox: units })]);
    assert.equal(plan.preview.canApprove, true);
    assert.deepEqual(
      plan.state!.boxes.map((box) => box.units),
      [units, units, units],
    );
    assert.equal(plan.state!.skus[0].unitsPerBox, 4);
    assert.equal(plan.preview.unitsDelta, 3 * units);
  }
});
test("explicit empty observation changes no stock, missing observation never implies zero", () => {
  const { state, row, run } = fixture();
  const empty = run([row(null)]);
  assert.equal(empty.preview.canApprove, true);
  assert.deepEqual(empty.state, state);
  assert.deepEqual(empty.results[Object.keys(empty.results)[0]], {
    palletId: null,
    boxIds: [],
  });
  const missing = row(null);
  delete missing.count!.openingPallet;
  assert.equal(run([missing]).preview.canApprove, false);
});
test("future, malformed, unknown, mixed and dimensionless inputs produce no provisional stock", () => {
  for (const mode of [
    "future",
    "invalid-date",
    "unknown-sku",
    "raw-batches",
    "zero",
    "height",
    "finished-size",
    "unknown-packaging",
    "non-euro",
    "raw-box-size",
  ] as const) {
    const { state, row, raw, finished, run } = fixture();
    let entry = structuredClone(raw);
    if (mode === "future") entry.batches[0].receivedAt = "2099-01-01T00:00:00Z";
    if (mode === "invalid-date")
      entry.batches[0].receivedAt = "2026-02-31T00:00:00Z";
    if (mode === "unknown-sku") entry.skuId = "missing";
    if (mode === "raw-batches") entry.batches.push({ ...entry.batches[0] });
    if (mode === "zero") entry.batches[0].quantity = 0;
    if (mode === "height") delete entry.heightMm;
    if (mode === "raw-box-size") entry.unitsPerBox = 20;
    if (mode === "finished-size") entry = { ...finished, heightMm: 900 };
    if (mode === "unknown-packaging") {
      entry = finished;
      state.skus[0].packaging = null as never;
    }
    if (mode === "non-euro") {
      entry = finished;
      state.skus[0].packaging.palletWidthMm = 1000;
    }
    const plan = run([row(entry)]);
    assert.equal(plan.state, null, mode);
    assert.equal(plan.preview.canApprove, false, mode);
  }
});
test("occupied, reserved, stale, blocked, archived, oversize and overweight addresses never approve", () => {
  for (const mode of [
    "occupied",
    "return",
    "movement",
    "stale",
    "blocked",
    "archived",
    "width",
    "height",
    "weight",
  ] as const) {
    const { state, location, row, raw, run } = fixture();
    const r = row(raw);
    const versions = new Map<string, number>();
    if (mode === "occupied")
      state.pallets.push({
        id: "physical",
        locationId: location.id,
        status: "stored",
        kind: "raw",
      } as D.PalletDto);
    if (mode === "return")
      state.pallets.push({
        id: "return",
        locationId: null,
        returnLocationId: location.id,
        status: "stored",
      } as D.PalletDto);
    if (mode === "movement")
      state.movements.push({
        id: "movement",
        fromLocationId: null,
        toLocationId: location.id,
        status: "planned",
      } as unknown as D.MovementDto);
    if (mode === "stale") versions.set(location.id, 1);
    if (mode === "blocked") location.blocked = true;
    if (mode === "archived") location.archived = true;
    if (mode === "width") location.availableWidthMm = 500;
    if (mode === "height") location.maxHeightMm = 500;
    if (mode === "weight") location.maxWeightKg = 100;
    const plan = run([r], versions);
    assert.equal(plan.state, null, mode);
    if (mode === "stale")
      assert.deepEqual(plan.preview.staleLocationIds, [location.id]);
  }
});
test("5000-box generation cap and pallet layer capacity fail before expansion", () => {
  const { row, finished, run } = fixture();
  const plan = run([
    row({
      ...finished,
      batches: [{ receivedAt: "2026-10-01", quantity: OPENING_MAX_BOXES + 1 }],
    }),
  ]);
  assert.equal(plan.state, null);
  assert.ok(plan.preview.issues.some((issue) => issue.code === "BOX_LIMIT"));
  assert.equal(
    run([
      row({
        ...finished,
        batches: [{ receivedAt: "2026-10-01", quantity: 100 }],
      }),
    ]).state,
    null,
  );
});
test("generated identity cannot merge a repeated import with existing stock", () => {
  const { state, row, raw, run } = fixture();
  const first = run([row(raw)]);
  const repeated = openingStocktakePlan(
    first.state!,
    [row(raw)],
    new Map(),
    4,
    doc,
    clock,
  );
  assert.equal(repeated.state, null);
  assert.equal(repeated.preview.canApprove, false);
  assert.ok(
    openingLocationIssues(first.state!, first.state!.pallets[0].locationId!)
      .length > 0,
  );
  assert.equal(state.pallets.length, 0);
});

test("the generated box cap applies to the whole document, not just each row", () => {
  const { state, location, finished, row, run } = fixture();
  state.skus[0].packaging.boxHeightMm = 1;
  state.skus[0].packaging.maxLayers = 1000;
  const addresses = state.locations
    .filter((candidate) => candidate.kind === "rack")
    .slice(0, 3);
  addresses.forEach((address) => {
    address.maxBoxes = 2000;
  });
  const observed = {
    ...finished,
    batches: [{ receivedAt: "2026-10-01", quantity: 2000 }],
  };
  const others: D.StocktakeRowSnapshotDto[] = addresses
    .slice(1)
    .map((address) => ({
      ...stocktakeRow(state, address.id, 0),
      countVersion: 0,
      count: { rawPallets: [], boxCodes: [], openingPallet: observed },
    }));
  assert.equal(addresses[0].id, location.id);
  const plan = run([row(observed), ...others]);
  assert.equal(plan.state, null);
  assert.ok(plan.preview.issues.some((issue) => issue.code === "BOX_LIMIT"));
  assert.equal(state.boxes.length, 0);
});
test("one address accepts at most 2000 printable opening box references", () => {
  const { state, location, row, finished, run } = fixture();
  state.skus[0].packaging.boxHeightMm = 1;
  state.skus[0].packaging.maxLayers = 1000;
  location.maxBoxes = 2000;
  const counted = (quantity: number) =>
    row({ ...finished, batches: [{ receivedAt: "2026-10-01", quantity }] });
  const rejected = run([counted(2001)]);
  assert.equal(rejected.state, null);
  assert.ok(
    rejected.preview.issues.some((issue) => issue.code === "ADDRESS_BOX_LIMIT"),
  );
  const accepted = run([counted(2000)]);
  assert.equal(
    accepted.preview.canApprove,
    true,
    JSON.stringify(accepted.preview.issues),
  );
  assert.equal(accepted.results[location.id].boxIds.length, 2000);
});
