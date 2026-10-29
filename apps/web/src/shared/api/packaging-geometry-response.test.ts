import assert from "node:assert/strict";
import { test } from "node:test";
import { hasValidLoadedPalletDimensions } from "./packaging-geometry-response";
import { isWorkspaceCommandResponse } from "./workspace-shape";
const base = { palletWidthMm: 1200, palletDepthMm: 800 };
function workspace(profile: unknown, collection: "skus" | "pallets" | "boxes") {
  const data = {
    skus: [],
    locations: [],
    lots: [],
    pallets: [],
    boxes: [],
    tasks: [],
    employees: [],
    shipments: [],
    activities: [],
  } as Record<string, unknown>;
  data[collection] = [
    { [collection === "skus" ? "packaging" : "packagingSnapshot"]: profile },
  ];
  return data;
}
test("load envelope guards preserve legacy missing fields and accept a measured overhang", () => {
  assert.equal(hasValidLoadedPalletDimensions(base), true);
  assert.equal(
    hasValidLoadedPalletDimensions({
      ...base,
      loadWidthMm: 1200,
      loadDepthMm: 900,
    }),
    true,
  );
  assert.equal(
    hasValidLoadedPalletDimensions({ ...base, loadDepthMm: 900 }),
    true,
  );
  for (const invalid of [
    { ...base, loadWidthMm: 1199 },
    { ...base, loadDepthMm: 799 },
    { ...base, loadWidthMm: null },
    { ...base, loadDepthMm: "900" },
    { ...base, loadWidthMm: NaN },
    { ...base, loadDepthMm: Infinity },
    { ...base, loadWidthMm: 1200.1 },
    { ...base, loadDepthMm: 5001 },
    { loadWidthMm: 1200 },
  ])
    assert.equal(hasValidLoadedPalletDimensions(invalid), false);
});
test("command guards validate the additive envelope in SKU and immutable pallet/box snapshots", () => {
  for (const collection of ["skus", "pallets", "boxes"] as const) {
    assert.equal(isWorkspaceCommandResponse(workspace(base, collection)), true);
    assert.equal(
      isWorkspaceCommandResponse(
        workspace({ ...base, loadWidthMm: 1200, loadDepthMm: 900 }, collection),
      ),
      true,
    );
    assert.equal(
      isWorkspaceCommandResponse(
        workspace({ ...base, loadWidthMm: 1100 }, collection),
      ),
      false,
    );
  }
});
